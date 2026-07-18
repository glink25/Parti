/**
 * Worker 侧类型：本地定义的 RoomContext（替代 any）。
 * 运行时行为见 docs/worker-api.md。
 */

import type { DartEventMap, GameState } from '../shared/protocol';

export interface RoomPlayer {
  id: string;
  name: string;
  role: 'host' | 'player' | 'spectator';
}

export interface WorkerContext {
  state: GameState;
  players: RoomPlayer[];
  host: RoomPlayer;

  now(): number;
  random(): number;

  broadcast<E extends keyof DartEventMap>(event: E, payload: DartEventMap[E]): void;
  send<E extends keyof DartEventMap>(playerId: string, event: E, payload: DartEventMap[E]): void;
  kick(playerId: string, reason?: string): void;
  log(...args: unknown[]): void;

  setTimer(name: string, ms: number, callback: () => void): void;
  clearTimer(name: string): void;
}

/** defineRoom 回调的 ctx 统一经此断言为本地类型 */
export function asCtx(ctx: unknown): WorkerContext {
  return ctx as WorkerContext;
}

export interface ActionEvent<P = unknown> {
  player: RoomPlayer;
  payload: P;
}
