/**
 * SessionStore —— 房间重连/持久化的唯一存储接触点 (GOAL.md §17 Phase 4, §13.1)。
 *
 * 设计目标：把「现场恢复」做成运行时内置的核心机制。创作者（room.worker.js）
 * 和接入方（apps/web 组件）都不直接调用 sessionStorage / localStorage——
 * 只与这一层抽象交互，从而减少心智负担。
 *
 * - 房主：持久化稳定身份（hostPeerId/hostPlayerId）+ 最新权威快照 + 玩家映射，
 *   刷新后据此恢复，房间 id（邀请链接）不变。
 * - 玩家：持久化稳定 clientId，刷新/掉线后凭它重连回同一玩家身份。
 */
import type { SnapshotPayload, PlayerRole } from '../protocol/messages.js';

/** 房主侧持久化的房间会话记录。 */
export interface RoomSessionRecord {
  roomId: string;
  /** 稳定的 host peer id —— 即邀请码，刷新后复用以保持邀请链接不变。 */
  hostPeerId: string;
  /** 稳定的 host player id。 */
  hostPlayerId: string;
  /** 最新权威快照，用于刷新后水合 worker。 */
  snapshot: SnapshotPayload;
  /** clientId ↔ playerId 映射，用于识别回归玩家并复用其身份。 */
  players: Array<{
    clientId: string;
    playerId: string;
    name: string;
    role: PlayerRole;
  }>;
  updatedAt: number;
}

/**
 * 持久化抽象。默认实现基于 sessionStorage（与 manifest
 * permissions.storage: "session" 声明一致）；测试用 MemorySessionStore。
 */
export interface SessionStore {
  loadRoom(roomId: string): RoomSessionRecord | null;
  saveRoom(record: RoomSessionRecord): void;
  clearRoom(roomId: string): void;

  /** 读取玩家在该房间的稳定身份 id（无则返回 null）。 */
  loadClientId(roomId: string): string | null;
  saveClientId(roomId: string, clientId: string): void;
  clearClientId(roomId: string): void;
}

const ROOM_PREFIX = 'parti:room:';
const CLIENT_PREFIX = 'parti:client:';

/** 取浏览器 sessionStorage；在无 window / SSR 环境返回 undefined。 */
function getSessionStorage(): Storage | undefined {
  try {
    if (typeof globalThis !== 'undefined') {
      const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
      if (s) return s;
    }
  } catch {
    // 访问 sessionStorage 可能抛出（如隐私模式），降级为无存储。
  }
  return undefined;
}

/**
 * 默认实现：基于 sessionStorage。
 * 无可用 storage 时所有方法降级为 no-op（loadXxx 返回 null）。
 */
export class SessionStorageStore implements SessionStore {
  private readonly storage = getSessionStorage();

  loadRoom(roomId: string): RoomSessionRecord | null {
    const raw = this.storage?.getItem(ROOM_PREFIX + roomId);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RoomSessionRecord;
    } catch {
      return null;
    }
  }

  saveRoom(record: RoomSessionRecord): void {
    try {
      this.storage?.setItem(
        ROOM_PREFIX + record.roomId,
        JSON.stringify(record),
      );
    } catch {
      // 配额超限等：忽略，持久化是尽力而为。
    }
  }

  clearRoom(roomId: string): void {
    this.storage?.removeItem(ROOM_PREFIX + roomId);
  }

  loadClientId(roomId: string): string | null {
    return this.storage?.getItem(CLIENT_PREFIX + roomId) ?? null;
  }

  saveClientId(roomId: string, clientId: string): void {
    try {
      this.storage?.setItem(CLIENT_PREFIX + roomId, clientId);
    } catch {
      // 忽略
    }
  }

  clearClientId(roomId: string): void {
    this.storage?.removeItem(CLIENT_PREFIX + roomId);
  }
}

/** 内存实现：用于单测，不依赖浏览器环境。 */
export class MemorySessionStore implements SessionStore {
  private readonly rooms = new Map<string, RoomSessionRecord>();
  private readonly clients = new Map<string, string>();

  loadRoom(roomId: string): RoomSessionRecord | null {
    const rec = this.rooms.get(roomId);
    // 返回深拷贝，避免外部持有可变引用造成串改。
    return rec ? (structuredClone(rec) as RoomSessionRecord) : null;
  }

  saveRoom(record: RoomSessionRecord): void {
    this.rooms.set(record.roomId, structuredClone(record) as RoomSessionRecord);
  }

  clearRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  loadClientId(roomId: string): string | null {
    return this.clients.get(roomId) ?? null;
  }

  saveClientId(roomId: string, clientId: string): void {
    this.clients.set(roomId, clientId);
  }

  clearClientId(roomId: string): void {
    this.clients.delete(roomId);
  }
}
