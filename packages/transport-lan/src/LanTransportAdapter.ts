import type {
  ClientTransportSession,
  CreateHostOptions,
  HostTransportSession,
  JoinRoomOptions,
  PeerId,
  TransportAdapter,
  TransportMessage,
} from '@parti/core';
import { FramedDataChannel } from './framing';
import {
  decodeLanPeerToken,
  decodeSignalingDescription,
  DEFAULT_LAN_SIGNALING_URL,
  encodeSignalingDescription,
  type LanPeerPresence,
  type LocalSendClientInfo,
  type LocalSendClientMessage,
  type LocalSendServerMessage,
} from './protocol';
import { acquireLanSignalingHub, type LanSignalingHub } from './signaling';

type SignalMessage = Extract<LocalSendServerMessage, { type: 'OFFER' | 'ANSWER' }>;
type OutgoingSignal = Extract<LocalSendClientMessage, { type: 'OFFER' | 'ANSWER' }>;

export interface LanSignalingPort {
  readonly instanceId: string;
  setPresence(presence: LanPeerPresence): void;
  getPresence?(): LanPeerPresence;
  subscribeSignal(handler: (message: SignalMessage) => void): () => void;
  waitForHost(hostId: string, roomId: string, timeoutMs?: number): Promise<LocalSendClientInfo>;
  sendSignal(message: OutgoingSignal): void;
}

export interface LanTransportAdapterOptions {
  serverUrl?: string;
  hub?: LanSignalingPort;
  peerConnectionFactory?: () => RTCPeerConnection;
  connectionTimeoutMs?: number;
}

interface HubLease { hub: LanSignalingPort; release(): void }

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const previous = peer.onicegatheringstatechange;
    const timer = setTimeout(() => {
      peer.onicegatheringstatechange = previous;
      reject(new Error('LAN ICE gathering timed out'));
    }, timeoutMs);
    peer.onicegatheringstatechange = (event) => {
      previous?.call(peer, event);
      if (peer.iceGatheringState === 'complete') {
        clearTimeout(timer);
        peer.onicegatheringstatechange = previous;
        resolve();
      }
    };
  });
}

function waitForChannelOpen(channel: RTCDataChannel, timeoutMs: number): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('LAN data channel timed out')), timeoutMs);
    channel.onopen = () => { clearTimeout(timer); resolve(); };
    channel.onerror = () => { clearTimeout(timer); reject(new Error('LAN data channel failed')); };
    channel.onclose = () => { clearTimeout(timer); reject(new Error('LAN data channel closed')); };
  });
}

export class LanTransportAdapter implements TransportAdapter {
  readonly name = 'lan';
  private readonly peerConnectionFactory: () => RTCPeerConnection;
  private readonly timeoutMs: number;

  constructor(private readonly options: LanTransportAdapterOptions = {}) {
    this.peerConnectionFactory = options.peerConnectionFactory ?? defaultPeerConnection;
    this.timeoutMs = options.connectionTimeoutMs ?? 10_000;
  }

  async createHost(options: CreateHostOptions): Promise<HostTransportSession> {
    const lease = this.acquireHub();
    const hub = lease.hub;
    const hostId = options.hostId ?? randomId();
    hub.setPresence({ role: 'host', instanceId: hub.instanceId, hostId, roomId: options.roomId });

    let connectionHandler: ((peer: { id: PeerId }) => void) | undefined;
    let messageHandler: ((peerId: PeerId, message: TransportMessage) => void) | undefined;
    let disconnectHandler: ((peerId: PeerId, reason?: string) => void) | undefined;
    const peers = new Map<string, { peer: RTCPeerConnection; framed: FramedDataChannel }>();
    const pendingPeers = new Map<RTCPeerConnection, ReturnType<typeof setTimeout>>();
    let closed = false;

    const clearPendingPeer = (peer: RTCPeerConnection) => {
      const timer = pendingPeers.get(peer);
      if (timer) clearTimeout(timer);
      pendingPeers.delete(peer);
    };

    const removePeer = (peerId: string, reason: string) => {
      const active = peers.get(peerId);
      if (!active) return;
      peers.delete(peerId);
      active.peer.close();
      disconnectHandler?.(peerId, reason);
    };

    const attachChannel = async (transportPeerId: string, peer: RTCPeerConnection, channel: RTCDataChannel) => {
      try {
        await waitForChannelOpen(channel, this.timeoutMs);
        if (closed) { channel.close(); peer.close(); return; }
        clearPendingPeer(peer);
        removePeer(transportPeerId, 'replaced');
        const framed = new FramedDataChannel(channel);
        peers.set(transportPeerId, { peer, framed });
        framed.onMessage((message) => messageHandler?.(transportPeerId, message));
        framed.onClose((reason) => removePeer(transportPeerId, reason ?? 'closed'));
        connectionHandler?.({ id: transportPeerId });
      } catch {
        clearPendingPeer(peer);
        peer.close();
      }
    };

    const offSignal = hub.subscribeSignal((message) => {
      if (message.type !== 'OFFER' || closed) return;
      const presence = decodeLanPeerToken(message.peer.token);
      const offer = decodeSignalingDescription(message.sdp);
      if (presence?.role !== 'client'
        || presence.targetHostId !== hostId
        || presence.roomId !== options.roomId
        || offer?.type !== 'offer') return;
      void (async () => {
        const peer = this.peerConnectionFactory();
        pendingPeers.set(peer, setTimeout(() => {
          pendingPeers.delete(peer);
          peer.close();
        }, this.timeoutMs));
        peer.ondatachannel = (event) => { void attachChannel(presence.transportPeerId, peer, event.channel); };
        try {
          await peer.setRemoteDescription(offer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await waitForIceGathering(peer, this.timeoutMs);
          if (!peer.localDescription) throw new Error('Missing LAN answer');
          hub.sendSignal({
            type: 'ANSWER',
            sessionId: message.sessionId,
            target: message.peer.id,
            sdp: encodeSignalingDescription(peer.localDescription),
          });
        } catch {
          clearPendingPeer(peer);
          peer.close();
        }
      })();
    });

    return {
      selfId: hostId,
      connectionInfo: hostId,
      send: (peerId, message) => peers.get(peerId)?.framed.send(message),
      broadcast: (message, config) => {
        const except = new Set(config?.except ?? []);
        for (const [peerId, active] of peers) if (!except.has(peerId)) active.framed.send(message);
      },
      onConnection: (handler) => { connectionHandler = handler; },
      onMessage: (handler) => { messageHandler = handler; },
      onDisconnect: (handler) => { disconnectHandler = handler; },
      close: () => {
        if (closed) return;
        closed = true;
        offSignal();
        for (const active of peers.values()) { active.framed.close(); active.peer.close(); }
        for (const [peer, timer] of pendingPeers) { clearTimeout(timer); peer.close(); }
        peers.clear();
        pendingPeers.clear();
        this.resetPresence(hub, 'host', hostId);
        lease.release();
      },
    };
  }

  async joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession> {
    const lease = this.acquireHub();
    const hub = lease.hub;
    const selfId = options.selfId ?? randomId();
    const hostId = options.hostConnectionInfo;
    hub.setPresence({
      role: 'client', instanceId: hub.instanceId, transportPeerId: selfId,
      targetHostId: hostId, roomId: options.roomId,
    });

    const host = await hub.waitForHost(hostId, options.roomId, this.timeoutMs).catch((error) => {
      this.resetPresence(hub, 'client', selfId);
      lease.release();
      throw error;
    });
    const peer = this.peerConnectionFactory();
    const channel = peer.createDataChannel(`parti:${options.roomId}`, { ordered: true });
    const sessionId = randomId();
    let answerResolve: ((description: RTCSessionDescriptionInit) => void) | undefined;
    let answerTimer: ReturnType<typeof setTimeout> | undefined;
    const answerPromise = new Promise<RTCSessionDescriptionInit>((resolve, reject) => {
      answerResolve = resolve;
      answerTimer = setTimeout(() => reject(new Error('LAN answer timed out')), this.timeoutMs);
    });
    const offSignal = hub.subscribeSignal((message) => {
      if (message.type !== 'ANSWER' || message.sessionId !== sessionId || message.peer.id !== host.id) return;
      const presence = decodeLanPeerToken(message.peer.token);
      const answer = decodeSignalingDescription(message.sdp);
      if (presence?.role !== 'host' || presence.hostId !== hostId || answer?.type !== 'answer') return;
      answerResolve?.(answer);
    });

    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, this.timeoutMs);
      if (!peer.localDescription) throw new Error('Missing LAN offer');
      hub.sendSignal({
        type: 'OFFER', sessionId, target: host.id,
        sdp: encodeSignalingDescription(peer.localDescription),
      });
      const answer = await answerPromise;
      if (answerTimer) clearTimeout(answerTimer);
      await peer.setRemoteDescription(answer);
      await waitForChannelOpen(channel, this.timeoutMs);
    } catch (error) {
      if (answerTimer) clearTimeout(answerTimer);
      offSignal();
      peer.close();
      this.resetPresence(hub, 'client', selfId);
      lease.release();
      throw error;
    }
    offSignal();

    const framed = new FramedDataChannel(channel);
    let messageHandler: ((message: TransportMessage) => void) | undefined;
    let disconnectHandler: ((reason?: string) => void) | undefined;
    let closed = false;
    framed.onMessage((message) => messageHandler?.(message));
    framed.onClose((reason) => disconnectHandler?.(reason));
    return {
      selfId,
      hostId,
      send: (message) => framed.send(message),
      onMessage: (handler) => { messageHandler = handler; },
      onDisconnect: (handler) => { disconnectHandler = handler; },
      close: () => {
        if (closed) return;
        closed = true;
        framed.close();
        peer.close();
        this.resetPresence(hub, 'client', selfId);
        lease.release();
      },
    };
  }

  private acquireHub(): HubLease {
    if (this.options.hub) return { hub: this.options.hub, release: () => {} };
    const lease = acquireLanSignalingHub(this.options.serverUrl ?? DEFAULT_LAN_SIGNALING_URL);
    return { hub: lease.hub, release: lease.release };
  }

  private resetPresence(hub: LanSignalingPort, role: 'host' | 'client', id: string): void {
    const current = hub.getPresence?.();
    const matches = role === 'host'
      ? current?.role === 'host' && current.hostId === id
      : current?.role === 'client' && current.transportPeerId === id;
    if (current === undefined || matches) hub.setPresence({ role: 'observer', instanceId: hub.instanceId });
  }
}

export function asLanSignalingHub(value: LanSignalingPort): LanSignalingHub | null {
  return 'subscribeRooms' in value ? value as LanSignalingHub : null;
}
