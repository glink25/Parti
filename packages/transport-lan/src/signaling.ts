import {
  decodeLanPeerToken,
  localSendInfo,
  type LanPeerPresence,
  type LanRoomAnnouncement,
  type LocalSendClientInfo,
  type LocalSendClientMessage,
  type LocalSendServerMessage,
} from './protocol';

export type LanDiscoveryStatus = 'connecting' | 'ready' | 'offline';

export interface LanDiscoveredRoom extends LanRoomAnnouncement {
  hostId: string;
  roomId: string;
  signalingPeerId: string;
}

export interface WebSocketLike {
  readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

type RoomSubscriber = (rooms: LanDiscoveredRoom[]) => void;
type StatusSubscriber = (status: LanDiscoveryStatus) => void;
type SignalSubscriber = (message: Extract<LocalSendServerMessage, { type: 'OFFER' | 'ANSWER' }>) => void;

function encodeQuery(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function defaultSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url);
}

function validPeer(value: unknown): value is LocalSendClientInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const peer = value as Partial<LocalSendClientInfo>;
  return typeof peer.id === 'string' && peer.id.length > 0 && peer.id.length <= 128
    && typeof peer.alias === 'string' && typeof peer.version === 'string'
    && typeof peer.token === 'string';
}

export class LanSignalingHub {
  private socket?: WebSocketLike;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private stopped = true;
  private status: LanDiscoveryStatus = 'connecting';
  private presence: LanPeerPresence;
  private selfId?: string;
  private readonly peers = new Map<string, LocalSendClientInfo>();
  private readonly roomSubscribers = new Set<RoomSubscriber>();
  private readonly statusSubscribers = new Set<StatusSubscriber>();
  private readonly signalSubscribers = new Set<SignalSubscriber>();

  constructor(
    readonly serverUrl: string,
    readonly instanceId: string,
    private readonly socketFactory: WebSocketFactory = defaultSocketFactory,
  ) {
    this.presence = { role: 'observer', instanceId };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close(1000, 'closed');
    this.socket = undefined;
    this.peers.clear();
    this.emitRooms();
  }

  setPresence(presence: LanPeerPresence): void {
    if (presence.instanceId !== this.instanceId) throw new Error('LAN presence instance does not match hub');
    this.presence = presence;
    if (this.socket?.readyState === 1) {
      this.send({ type: 'UPDATE', info: localSendInfo(presence) });
    }
  }

  getPresence(): LanPeerPresence {
    return this.presence;
  }

  getSelfId(): string | undefined {
    return this.selfId;
  }

  subscribeRooms(subscriber: RoomSubscriber): () => void {
    this.roomSubscribers.add(subscriber);
    subscriber(this.rooms());
    return () => this.roomSubscribers.delete(subscriber);
  }

  subscribeStatus(subscriber: StatusSubscriber): () => void {
    this.statusSubscribers.add(subscriber);
    subscriber(this.status);
    return () => this.statusSubscribers.delete(subscriber);
  }

  subscribeSignal(subscriber: SignalSubscriber): () => void {
    this.signalSubscribers.add(subscriber);
    return () => this.signalSubscribers.delete(subscriber);
  }

  findHost(hostId: string, roomId?: string): LocalSendClientInfo | undefined {
    return [...this.peers.values()].find((peer) => {
      const presence = decodeLanPeerToken(peer.token);
      return presence?.role === 'host'
        && presence.hostId === hostId
        && (roomId === undefined || presence.roomId === roomId);
    });
  }

  waitForHost(hostId: string, roomId: string, timeoutMs = 10_000): Promise<LocalSendClientInfo> {
    const current = this.findHost(hostId, roomId);
    if (current) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('LAN host was not found'));
      }, timeoutMs);
      const off = this.subscribeRooms(() => {
        const peer = this.findHost(hostId, roomId);
        if (!peer) return;
        clearTimeout(timer);
        off();
        resolve(peer);
      });
    });
  }

  sendSignal(message: Extract<LocalSendClientMessage, { type: 'OFFER' | 'ANSWER' }>): void {
    this.send(message);
  }

  private connect(): void {
    if (this.stopped) return;
    this.setStatus('connecting');
    const info = encodeQuery(JSON.stringify(localSendInfo(this.presence)));
    const separator = this.serverUrl.includes('?') ? '&' : '?';
    let socket: WebSocketLike;
    try {
      socket = this.socketFactory(`${this.serverUrl}${separator}d=${info}`);
    } catch {
      this.handleDisconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {};
    socket.onmessage = (event) => this.onMessage(event.data);
    socket.onerror = () => this.setStatus('offline');
    socket.onclose = () => this.handleDisconnect();
  }

  private handleDisconnect(): void {
    if (this.stopped) return;
    this.socket = undefined;
    this.selfId = undefined;
    this.peers.clear();
    this.emitRooms();
    this.setStatus('offline');
    const wait = Math.min(500 * 2 ** this.reconnectAttempt, 10_000);
    this.reconnectAttempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, wait);
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: LocalSendServerMessage;
    try {
      message = JSON.parse(raw) as LocalSendServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'HELLO':
        if (!validPeer(message.client) || !Array.isArray(message.peers)) return;
        this.selfId = message.client.id;
        this.peers.clear();
        for (const peer of message.peers) if (validPeer(peer)) this.peers.set(peer.id, peer);
        this.reconnectAttempt = 0;
        this.setStatus('ready');
        this.send({ type: 'UPDATE', info: localSendInfo(this.presence) });
        this.emitRooms();
        return;
      case 'JOIN':
      case 'UPDATE':
        if (!validPeer(message.peer)) return;
        this.peers.set(message.peer.id, message.peer);
        this.emitRooms();
        return;
      case 'LEFT':
        if (typeof message.peerId !== 'string') return;
        this.peers.delete(message.peerId);
        this.emitRooms();
        return;
      case 'OFFER':
      case 'ANSWER':
        if (!validPeer(message.peer) || typeof message.sessionId !== 'string' || typeof message.sdp !== 'string') return;
        // LocalSend routes SDP with the ClientInfo captured when the WebSocket connected.
        // Presence changes sent through UPDATE are stored separately by the server, so the
        // envelope may still say "observer" even though this peer is now a host/client.
        // Use the latest JOIN/UPDATE snapshot while retaining the routed peer UUID.
        const peer = this.peers.get(message.peer.id) ?? message.peer;
        for (const subscriber of [...this.signalSubscribers]) subscriber({ ...message, peer });
        return;
      case 'ERROR':
        if (this.socket) {
          const socket = this.socket;
          socket.onclose = null;
          socket.close(1011, 'signaling-error');
        }
        this.handleDisconnect();
    }
  }

  private rooms(): LanDiscoveredRoom[] {
    const rooms = new Map<string, LanDiscoveredRoom>();
    for (const peer of this.peers.values()) {
      const presence = decodeLanPeerToken(peer.token);
      if (presence?.role !== 'host' || !presence.announcement) continue;
      rooms.set(`${presence.hostId}\0${presence.roomId}`, {
        hostId: presence.hostId,
        roomId: presence.roomId,
        signalingPeerId: peer.id,
        ...presence.announcement,
      });
    }
    return [...rooms.values()];
  }

  private emitRooms(): void {
    const rooms = this.rooms();
    for (const subscriber of [...this.roomSubscribers]) subscriber(rooms);
  }

  private setStatus(status: LanDiscoveryStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const subscriber of [...this.statusSubscribers]) subscriber(status);
  }

  private send(message: LocalSendClientMessage): void {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('LAN signaling is not connected');
    this.socket.send(JSON.stringify(message));
  }
}

interface SharedEntry { hub: LanSignalingHub; refs: number }
const sharedHubs = new Map<string, SharedEntry>();

function randomInstanceId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function acquireLanSignalingHub(serverUrl: string): { hub: LanSignalingHub; release(): void } {
  let entry = sharedHubs.get(serverUrl);
  if (!entry) {
    entry = { hub: new LanSignalingHub(serverUrl, randomInstanceId()), refs: 0 };
    sharedHubs.set(serverUrl, entry);
    entry.hub.start();
  }
  entry.refs += 1;
  let released = false;
  return {
    hub: entry.hub,
    release: () => {
      if (released) return;
      released = true;
      entry!.refs -= 1;
      if (entry!.refs === 0) {
        entry!.hub.close();
        sharedHubs.delete(serverUrl);
      }
    },
  };
}
