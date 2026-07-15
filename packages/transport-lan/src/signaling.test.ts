import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeLanPeerToken, encodeLanPeerToken, type LocalSendClientInfo } from './protocol';
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

function peer(id: string, token: string): LocalSendClientInfo {
  return { id, alias: 'Parti', version: '2.3', deviceType: 'WEB', token };
}

describe('LAN signaling discovery', () => {
  afterEach(() => vi.useRealTimers());
  it('publishes only valid Parti host rooms and removes peers that leave', () => {
    const socket = new FakeSocket();
    const hub = new LanSignalingHub('wss://signal.test/v1/ws', 'observer-1', () => socket);
    const snapshots: string[][] = [];
    hub.subscribeRooms((rooms) => snapshots.push(rooms.map((room) => room.title)));
    hub.start();
    socket.open();
    socket.receive({
      type: 'HELLO',
      client: peer('self', encodeLanPeerToken({ role: 'observer', instanceId: 'observer-1' })),
      peers: [
        peer('native', 'native-token'),
        peer('host-signal', encodeLanPeerToken({
          role: 'host', instanceId: 'host-instance', hostId: 'stable-host', roomId: 'counter',
          announcement: { title: 'LAN Counter', packageName: 'Counter', playerCount: 1, maxPlayers: 4, joinable: true, credentialRequired: false },
        })),
      ],
    });

    expect(snapshots.at(-1)).toEqual(['LAN Counter']);
    expect(hub.findHost('stable-host')?.id).toBe('host-signal');

    socket.receive({ type: 'LEFT', peerId: 'host-signal' });
    expect(snapshots.at(-1)).toEqual([]);
  });

  it('sends presence updates over the established shared connection', () => {
    const socket = new FakeSocket();
    const hub = new LanSignalingHub('wss://signal.test/v1/ws', 'instance-1', () => socket);
    hub.start();
    hub.setPresence({ role: 'client', instanceId: 'instance-1', transportPeerId: 'client-1', targetHostId: 'host-1', roomId: 'counter' });
    socket.open();
    socket.receive({
      type: 'HELLO',
      client: peer('self', encodeLanPeerToken({ role: 'observer', instanceId: 'instance-1' })),
      peers: [],
    });

    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: 'UPDATE',
      info: { token: expect.stringMatching(/^parti\.lan\.v1\./) },
    });
    expect(decodeLanPeerToken(JSON.parse(socket.sent.at(-1)!).info.token)).toMatchObject({ role: 'client', transportPeerId: 'client-1' });
  });

  it('deduplicates announcements by stable host and restores presence after reconnecting', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const hub = new LanSignalingHub('wss://signal.test/v1/ws', 'instance-1', (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    hub.start();
    const first = sockets[0]!;
    first.open();
    first.receive({
      type: 'HELLO',
      client: peer('self', encodeLanPeerToken({ role: 'observer', instanceId: 'instance-1' })),
      peers: [
        peer('old-peer', encodeLanPeerToken({
          role: 'host', instanceId: 'old', hostId: 'stable-host', roomId: 'counter',
          announcement: { title: 'Old', packageName: 'Counter', playerCount: 1, maxPlayers: 4, joinable: true, credentialRequired: false },
        })),
        peer('new-peer', encodeLanPeerToken({
          role: 'host', instanceId: 'new', hostId: 'stable-host', roomId: 'counter',
          announcement: { title: 'Current', packageName: 'Counter', playerCount: 2, maxPlayers: 4, joinable: true, credentialRequired: false },
        })),
      ],
    });
    const snapshots: string[][] = [];
    hub.subscribeRooms((rooms) => snapshots.push(rooms.map((room) => room.title)));
    expect(snapshots.at(-1)).toEqual(['Current']);

    hub.setPresence({ role: 'host', instanceId: 'instance-1', hostId: 'stable-self', roomId: 'counter' });
    first.onclose?.({} as CloseEvent);
    await vi.advanceTimersByTimeAsync(500);

    expect(sockets).toHaveLength(2);
    const encodedInfo = new URL(urls[1]!).searchParams.get('d')!;
    const info = JSON.parse(Buffer.from(encodedInfo, 'base64url').toString()) as { token: string };
    expect(decodeLanPeerToken(info.token)).toMatchObject({ role: 'host', hostId: 'stable-self' });
  });
});
