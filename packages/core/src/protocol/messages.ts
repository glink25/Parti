/**
 * Parti 标准 Room Protocol —— 消息类型定义 (GOAL.md §8)
 *
 * 所有跨 Transport 的消息都使用统一 envelope。Transport 不理解游戏语义，
 * 只负责传输 RoomMessage。协议稳定是房间生态的前提 (§20.2)。
 */

export const PROTOCOL_VERSION = 1;

/** 消息通道 (§8.1) */
export type Channel = 'sys' | 'input' | 'state' | 'event' | 'rpc' | 'debug';

/** 统一消息 envelope (§8.1) */
export interface RoomMessage<T = unknown> {
  /** 协议版本 */
  v: 1;
  /** 消息唯一 ID */
  id: string;
  /** 房间 ID */
  roomId: string;
  /** 发送者 ID */
  from: string;
  /** 接收者 ID，可选 */
  to?: string;
  /** 连接内递增序号 */
  seq: number;
  /** 已确认收到的序号，可选 */
  ack?: number;
  /** 消息通道 */
  channel: Channel;
  /** 消息类型 */
  type: string;
  /** 发送时间 */
  ts: number;
  /** 消息数据 */
  payload: T;
}

/** 系统消息类型 (§8.2) */
export type SystemMessageType =
  | 'sys:hello'
  | 'sys:welcome'
  | 'sys:join'
  | 'sys:leave'
  | 'sys:ready'
  | 'sys:ping'
  | 'sys:pong'
  | 'sys:error'
  | 'sys:kick'
  | 'sys:host-closed'
  | 'sys:resync-request'
  | 'sys:resume-ok'
  | 'sys:package-request'
  | 'sys:package-data'
  | 'sys:capabilities';

/** 游戏消息类型 (§8.3) */
export type GameMessageType =
  | 'game:action'
  | 'game:event'
  | 'game:rpc'
  | 'game:rpc-result';

/** 状态消息类型 (§8.4) */
export type StateMessageType =
  | 'state:snapshot'
  | 'state:patch'
  | 'state:hash'
  | 'state:resync';

export type RoomMessageType =
  | SystemMessageType
  | GameMessageType
  | StateMessageType;

// ---------------------------------------------------------------------------
// Payload 类型
// ---------------------------------------------------------------------------

/** 玩家在协议层的能力声明 */
export interface Capabilities {
  binary?: boolean;
  compression?: boolean;
  patch?: boolean;
}

/** sys:hello (§8.6) —— 玩家加入时上报 */
export interface HelloPayload {
  partiVersion: string;
  protocolVersion: number;
  roomPackageHash: string;
  player: {
    name?: string;
    avatar?: string;
    /**
     * 稳定的客户端身份 id（跨刷新/掉线持久化）。Host 据此识别回归玩家并
     * 复用其原 playerId，走重连路径而非 new-join。首次加入可无。
     */
    clientId?: string;
  };
  capabilities: Capabilities;
  /** 可选准入凭据；Runtime 仅把它交给 admission controller，不传入 Worker。 */
  admission?: {
    credential?: string;
  };
}

/** sys:resume-ok —— Host 确认玩家重连成功，回带其原 playerId。 */
export interface ResumeOkPayload {
  playerId: string;
  /** 重连后房间内最新版本号 */
  stateVersion: number;
}

/**
 * sys:package-data —— Host 把房间代码包分发给加入者 (GOAL §11.1 内容寻址)。
 *
 * 仅含纯数据（manifest + 文件文本），core 不依赖 room-packager。加入者收到后
 * 自行重算 packageHash 校验内容一致，再走 sys:hello。MVP 无后端，房间文件
 * 经此消息点对点下发，而非 fetch 静态 URL。
 */
export interface PackageDataPayload {
  manifest: unknown;
  /** 相对路径 -> 文本内容 */
  files: Record<string, string>;
}

/** sys:package-request —— 在下发房间代码前执行与正式加入相同的准入校验。 */
export interface PackageRequestPayload {
  partiVersion: string;
  clientId?: string;
  credential?: string;
}

export type PlayerRole = 'host' | 'player' | 'spectator';
export type PlayerStatus = 'connected' | 'ready' | 'offline';

export interface WelcomePlayer {
  id: string;
  name: string;
  role: PlayerRole;
  status: PlayerStatus;
}

/** sys:welcome (§8.7) —— Host 回应加入 */
export interface WelcomePayload {
  playerId: string;
  role: PlayerRole;
  room: {
    id: string;
    packageHash: string;
    createdAt: number;
  };
  players: WelcomePlayer[];
  stateVersion: number;
}

/** game:action (§8.8) —— 玩家提交意图 */
export interface ActionPayload {
  action: string;
  payload: unknown;
  clientActionId: string;
}

/** game:event (§8.9) —— Host 广播游戏事件 */
export interface EventPayload {
  event: string;
  payload: unknown;
}

/** state:snapshot (§8.10) —— 完整状态快照 */
export interface SnapshotPayload {
  version: number;
  state: unknown;
  stateHash: string;
}

/** state:patch (§8.11) —— 增量变更，MVP 暂不实现，仅保留类型 */
export interface StatePatchPayload {
  baseVersion: number;
  nextVersion: number;
  patch: Array<{
    op: 'add' | 'remove' | 'replace';
    path: string;
    value?: unknown;
  }>;
  stateHash: string;
}

/** 统一错误码 (§8.12) */
export type RoomErrorCode =
  | 'ROOM_FULL'
  | 'CREDENTIAL_REQUIRED'
  | 'INVALID_CREDENTIAL'
  | 'VERSION_MISMATCH'
  | 'INVALID_ACTION'
  | 'BAD_PAYLOAD'
  | 'FORBIDDEN'
  | 'STATE_OUT_OF_SYNC'
  | 'HOST_CLOSED'
  | 'RUNTIME_ERROR'
  | 'TRANSPORT_ERROR';

/** sys:error (§8.12) */
export interface RoomErrorPayload {
  code: RoomErrorCode;
  message: string;
  recoverable: boolean;
  detail?: unknown;
}

/** sys:kick */
export interface KickPayload {
  reason?: string;
}

/** sys:ready */
export interface ReadyPayload {
  payload?: unknown;
}

/**
 * 返回用于日志/调试的消息副本，递归隐藏所有名为 credential 的字段。
 * 原消息仍用于协议处理，避免日志脱敏改变实际传输数据。
 */
export function redactRoomMessage(message: RoomMessage): RoomMessage {
  return { ...message, payload: redactCredentials(message.payload) };
}

function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!value || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = key === 'credential' ? '[REDACTED]' : redactCredentials(child);
  }
  return redacted;
}
