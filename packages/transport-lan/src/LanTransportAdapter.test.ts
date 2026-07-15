import { describe, expect, it } from 'vitest';
import {
  encodeLanPeerToken,
  encodeSignalingDescription,
  type LanPeerPresence,
  type LocalSendClientInfo,
  type LocalSendClientMessage,
  type LocalSendServerMessage,
} from './protocol';
import { LanTransportAdapter, type LanSignalingPort } from './LanTransportAdapter';
import { LanSignalingHub, type WebSocketLike } from './signaling';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  binaryType: BinaryType = 'blob';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.onopen?.(new Event('open')); }
  receive(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
}

class FakeDataChannel {
  readyState: RTCDataChannelState = 'open';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send(): void {}
  close(): void { this.readyState = 'closed'; }
}

class FakePeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = 'complete';
  connectionState: RTCPeerConnectionState = 'connected';
  onicegatheringstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly channel = new FakeDataChannel();
  remote?: RTCSessionDescriptionInit;

  createDataChannel(): RTCDataChannel { return this.channel as unknown as RTCDataChannel; }
  async createOffer(): Promise<RTCSessionDescriptionInit> { return { type: 'offer', sdp: 'offer-sdp' }; }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { return { type: 'answer', sdp: 'answer-sdp' }; }
  async setLocalDescription(value: RTCSessionDescriptionInit): Promise<void> { this.localDescription = value; }
  async setRemoteDescription(value: RTCSessionDescriptionInit): Promise<void> { this.remote = value; }
  close(): void { this.connectionState = 'closed'; }
}

class FakeHub implements LanSignalingPort {
  readonly instanceId = 'hub-instance';
  presence: LanPeerPresence = { role: 'observer', instanceId: this.instanceId };
  sent: Array<Extract<LocalSendClientMessage, { type: 'OFFER' | 'ANSWER' }>> = [];
  signal?: (message: Extract<LocalSendServerMessage, { type: 'OFFER' | 'ANSWER' }>) => void;
  host: LocalSendClientInfo = {
    id: 'ephemeral-host', alias: 'Parti', version: '2.3', token: encodeLanPeerToken({
      role: 'host', instanceId: 'host-instance', hostId: 'stable-host', roomId: 'counter',
    }),
  };
  setPresence(value: LanPeerPresence): void { this.presence = value; }
  subscribeSignal(handler: typeof this.signal): () => void { this.signal = handler; return () => { this.signal = undefined; }; }
  async waitForHost(): Promise<LocalSendClientInfo> { return this.host; }
  sendSignal(message: Extract<LocalSendClientMessage, { type: 'OFFER' | 'ANSWER' }>): void {
    this.sent.push(message);
    if (message.type === 'OFFER') {
      this.signal?.({
        type: 'ANSWER', peer: this.host, sessionId: message.sessionId,
        sdp: encodeSignalingDescription({ type: 'answer', sdp: 'answer-sdp' }),
      });
    }
  }
}

describe('LAN transport adapter', () => {
  it('resolves a stable host id and establishes a direct client data channel', async () => {
    const hub = new FakeHub();
    const peer = new FakePeerConnection();
    const adapter = new LanTransportAdapter({
      hub,
      peerConnectionFactory: () => peer as unknown as RTCPeerConnection,
    });

    const session = await adapter.joinRoom({ roomId: 'counter', hostConnectionInfo: 'stable-host', selfId: 'client-1' });

    expect(session.selfId).toBe('client-1');
    expect(session.hostId).toBe('stable-host');
    expect(hub.presence).toMatchObject({ role: 'client', targetHostId: 'stable-host', roomId: 'counter' });
    expect(hub.sent[0]).toMatchObject({ type: 'OFFER', target: 'ephemeral-host' });
    expect(peer.remote).toEqual({ type: 'answer', sdp: 'answer-sdp' });
  });

  it('answers multiple concurrent client signaling sessions independently', async () => {
    const hub = new FakeHub();
    const peers: FakePeerConnection[] = [];
    const adapter = new LanTransportAdapter({
      hub,
      peerConnectionFactory: () => {
        const peer = new FakePeerConnection();
        peers.push(peer);
        return peer as unknown as RTCPeerConnection;
      },
    });
    const host = await adapter.createHost({ roomId: 'counter', hostId: 'stable-host' });
    const client = (id: string, transportPeerId: string): LocalSendClientInfo => ({
      id,
      alias: 'Parti',
      version: '2.3',
      token: encodeLanPeerToken({
        role: 'client', instanceId: `instance-${id}`, transportPeerId,
        targetHostId: 'stable-host', roomId: 'counter',
      }),
    });

    hub.signal?.({
      type: 'OFFER', peer: client('signal-a', 'client-a'), sessionId: 'session-a',
      sdp: encodeSignalingDescription({ type: 'offer', sdp: 'offer-a' }),
    });
    hub.signal?.({
      type: 'OFFER', peer: client('signal-b', 'client-b'), sessionId: 'session-b',
      sdp: encodeSignalingDescription({ type: 'offer', sdp: 'offer-b' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(peers).toHaveLength(2);
    expect(hub.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'ANSWER', sessionId: 'session-a', target: 'signal-a' }),
      expect.objectContaining({ type: 'ANSWER', sessionId: 'session-b', target: 'signal-b' }),
    ]));
    host.close();
  });

  it('answers offers whose server envelope contains the peer metadata from initial connection', async () => {
    const socket = new FakeSocket();
    const hub = new LanSignalingHub('wss://signal.test/v1/ws', 'host-instance', () => socket);
    hub.start();
    socket.open();
    socket.receive({
      type: 'HELLO',
      client: {
        id: 'host-signal', alias: 'Parti', version: '2.3',
        token: encodeLanPeerToken({ role: 'observer', instanceId: 'host-instance' }),
      },
      peers: [],
    });
    const adapter = new LanTransportAdapter({
      hub,
      peerConnectionFactory: () => new FakePeerConnection() as unknown as RTCPeerConnection,
    });
    const host = await adapter.createHost({ roomId: 'counter', hostId: 'stable-host' });
    const currentClient = {
      id: 'client-signal', alias: 'Parti', version: '2.3',
      token: encodeLanPeerToken({
        role: 'client', instanceId: 'client-instance', transportPeerId: 'client-1',
        targetHostId: 'stable-host', roomId: 'counter',
      }),
    };
    socket.receive({ type: 'UPDATE', peer: currentClient });
    socket.receive({
      type: 'OFFER',
      peer: {
        ...currentClient,
        token: encodeLanPeerToken({ role: 'observer', instanceId: 'client-instance' }),
      },
      sessionId: 'session-stale-envelope',
      sdp: encodeSignalingDescription({ type: 'offer', sdp: 'offer-sdp' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual(expect.objectContaining({
      type: 'ANSWER', sessionId: 'session-stale-envelope', target: 'client-signal',
    }));
    host.close();
    hub.close();
  });
});
