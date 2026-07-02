/**
 * 内部桥协议 —— 主线程 WorkerHost ↔ Web Worker (worker-entry) 之间私有协议。
 * 对创作者不可见 (§9.1)。
 */
import type { RoomPlayer } from './defineRoom';

export type MainToWorker =
  | { kind: 'init'; roomId: string; roomSource: string; manifest?: unknown; host: RoomPlayer; restoreState?: unknown }
  | { kind: 'join'; player: RoomPlayer }
  | { kind: 'reconnect'; player: RoomPlayer }
  | { kind: 'leave'; player: RoomPlayer }
  | { kind: 'ready'; player: RoomPlayer }
  | { kind: 'action'; player: RoomPlayer; action: string; payload: unknown; actionId: string }
  | { kind: 'dispose' };

export type WorkerToMain =
  | { kind: 'init-ack' }
  | { kind: 'state'; state: unknown }
  | { kind: 'broadcast'; event: string; payload: unknown }
  | { kind: 'send'; playerId: string; event: string; payload: unknown }
  | { kind: 'kick'; playerId: string; reason: string | undefined }
  | { kind: 'log'; args: unknown[] }
  | { kind: 'error'; error: { message: string; stack?: string } };
