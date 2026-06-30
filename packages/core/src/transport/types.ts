/**
 * Transport 抽象 (GOAL.md §7) —— Runtime 只依赖此接口，不绑定具体实现。
 *
 * Transport 不理解游戏，只负责传输标准 RoomMessage (§7.1)。
 * 不同实现：transport-local / transport-peerjs / transport-socketio ...
 */

export type PeerId = string;
export type RoomId = string;

/** Transport 层传输的消息包装 (§7.2) */
export interface TransportMessage {
  data: ArrayBuffer | string | object;
  meta?: {
    reliable?: boolean;
    ordered?: boolean;
    channel?: string;
  };
}

/** 新连接进来时携带的 peer 信息 */
export interface TransportPeer {
  id: PeerId;
}

/** Host 侧会话：管理多个玩家连接 (§7.2) */
export interface HostTransportSession {
  selfId: PeerId;
  /** 邀请其他玩家所需的连接信息（如 PeerJS peer id）。Local 模式为 roomId。 */
  readonly connectionInfo: string;

  send(peerId: PeerId, message: TransportMessage): void;
  broadcast(message: TransportMessage, options?: { except?: PeerId[] }): void;

  onConnection(handler: (peer: TransportPeer) => void): void;
  onMessage(handler: (peerId: PeerId, message: TransportMessage) => void): void;
  onDisconnect(handler: (peerId: PeerId, reason?: string) => void): void;

  close(): void;
}

/** Client 侧会话：与单一 Host 通信 (§7.2) */
export interface ClientTransportSession {
  selfId: PeerId;
  hostId: PeerId;

  send(message: TransportMessage): void;

  onMessage(handler: (message: TransportMessage) => void): void;
  onDisconnect(handler: (reason?: string) => void): void;

  close(): void;
}

export interface CreateHostOptions {
  roomId: RoomId;
  /** 可选：期望的 host peer id（部分 transport 支持指定）。 */
  hostId?: PeerId;
}

export interface JoinRoomOptions {
  roomId: RoomId;
  /** Host 的连接信息（connectionInfo）。 */
  hostConnectionInfo: string;
  /** 可选：客户端自身 peer id。 */
  selfId?: PeerId;
}

/** 统一 Transport 适配器入口 (§2.2) */
export interface TransportAdapter {
  readonly name: string;
  createHost(options: CreateHostOptions): Promise<HostTransportSession>;
  joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession>;
}
