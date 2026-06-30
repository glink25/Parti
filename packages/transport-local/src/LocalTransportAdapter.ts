/**
 * LocalTransportAdapter (GOAL.md §7.5) —— 内存模拟多人连接。
 *
 * 不走真实网络，host 与 client 共享同一进程内 bus。用于：
 *  - 单元测试 / 协议测试
 *  - 编辑器本地多人预览（一个页面里 host + N 个虚拟玩家）
 *  - DevTools
 *
 * 实现了与真实 transport 完全一致的接口，因此 Runtime 无需感知差异。
 */
import type {
  ClientTransportSession,
  CreateHostOptions,
  HostTransportSession,
  JoinRoomOptions,
  PeerId,
  TransportAdapter,
  TransportMessage,
  TransportPeer,
} from '@parti/core';

type MessageHandler = (peerId: PeerId, message: TransportMessage) => void;
type ClientMessageHandler = (message: TransportMessage) => void;

/** 一个房间的内存中枢，连接 host 与各 client。 */
class LocalHub {
  hostId: PeerId;
  private connectionHandlers: ((peer: TransportPeer) => void)[] = [];
  private hostMessageHandlers: MessageHandler[] = [];
  private hostDisconnectHandlers: ((peerId: PeerId, reason?: string) => void)[] = [];

  // 每个 client 的入站处理器（host -> client 方向）
  private clientInbound = new Map<PeerId, ClientMessageHandler[]>();
  private clientDisconnect = new Map<PeerId, ((reason?: string) => void)[]>();

  constructor(
    readonly roomId: string,
    hostId: PeerId,
  ) {
    this.hostId = hostId;
  }

  onConnection(handler: (peer: TransportPeer) => void): void {
    this.connectionHandlers.push(handler);
  }
  onHostMessage(handler: MessageHandler): void {
    this.hostMessageHandlers.push(handler);
  }
  onHostDisconnect(handler: (peerId: PeerId, reason?: string) => void): void {
    this.hostDisconnectHandlers.push(handler);
  }

  registerClient(peerId: PeerId): void {
    this.clientInbound.set(peerId, []);
    this.clientDisconnect.set(peerId, []);
    // 异步通知 host，模拟网络连接事件
    queueMicrotask(() => {
      for (const h of this.connectionHandlers) h({ id: peerId });
    });
  }

  onClientMessage(peerId: PeerId, handler: ClientMessageHandler): void {
    this.clientInbound.get(peerId)?.push(handler);
  }
  onClientDisconnect(peerId: PeerId, handler: (reason?: string) => void): void {
    this.clientDisconnect.get(peerId)?.push(handler);
  }

  // client -> host
  sendToHost(peerId: PeerId, message: TransportMessage): void {
    const clone = cloneMessage(message);
    queueMicrotask(() => {
      for (const h of this.hostMessageHandlers) h(peerId, clone);
    });
  }

  // host -> client
  sendToClient(peerId: PeerId, message: TransportMessage): void {
    const handlers = this.clientInbound.get(peerId);
    if (!handlers) return;
    const clone = cloneMessage(message);
    queueMicrotask(() => {
      for (const h of handlers) h(clone);
    });
  }

  broadcast(message: TransportMessage, except: PeerId[] = []): void {
    for (const peerId of this.clientInbound.keys()) {
      if (except.includes(peerId)) continue;
      this.sendToClient(peerId, message);
    }
  }

  disconnectClient(peerId: PeerId, reason?: string): void {
    queueMicrotask(() => {
      for (const h of this.hostDisconnectHandlers) h(peerId, reason);
      for (const h of this.clientDisconnect.get(peerId) ?? []) h(reason);
    });
    this.clientInbound.delete(peerId);
    this.clientDisconnect.delete(peerId);
  }

  closeHost(): void {
    for (const peerId of [...this.clientInbound.keys()]) {
      for (const h of this.clientDisconnect.get(peerId) ?? []) h('host-closed');
    }
    this.clientInbound.clear();
    this.clientDisconnect.clear();
  }
}

/** 结构化克隆，模拟跨连接的序列化边界，避免共享引用泄漏。 */
function cloneMessage(message: TransportMessage): TransportMessage {
  return {
    data:
      typeof message.data === 'object' && message.data !== null
        ? structuredClone(message.data)
        : message.data,
    ...(message.meta ? { meta: { ...message.meta } } : {}),
  };
}

let peerCounter = 0;
function nextPeerId(prefix: string): PeerId {
  peerCounter += 1;
  return `${prefix}-${peerCounter}`;
}

export class LocalTransportAdapter implements TransportAdapter {
  readonly name = 'local';

  /** 每个 adapter 实例自带一个房间注册表，便于隔离测试。 */
  private readonly hubs = new Map<string, LocalHub>();

  async createHost(options: CreateHostOptions): Promise<HostTransportSession> {
    const hostId = options.hostId ?? nextPeerId('host');
    const hub = new LocalHub(options.roomId, hostId);
    this.hubs.set(options.roomId, hub);

    const session: HostTransportSession = {
      selfId: hostId,
      connectionInfo: options.roomId,
      send: (peerId, message) => hub.sendToClient(peerId, message),
      broadcast: (message, opts) => hub.broadcast(message, opts?.except),
      onConnection: (handler) => hub.onConnection(handler),
      onMessage: (handler) => hub.onHostMessage(handler),
      onDisconnect: (handler) => hub.onHostDisconnect(handler),
      close: () => {
        hub.closeHost();
        this.hubs.delete(options.roomId);
      },
    };
    return session;
  }

  async joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession> {
    const hub = this.hubs.get(options.roomId);
    if (!hub) {
      throw new Error(`本地房间不存在: ${options.roomId}`);
    }
    const selfId = options.selfId ?? nextPeerId('player');
    hub.registerClient(selfId);

    const session: ClientTransportSession = {
      selfId,
      hostId: hub.hostId,
      send: (message) => hub.sendToHost(selfId, message),
      onMessage: (handler) => hub.onClientMessage(selfId, handler),
      onDisconnect: (handler) => hub.onClientDisconnect(selfId, handler),
      close: () => hub.disconnectClient(selfId),
    };
    return session;
  }
}
