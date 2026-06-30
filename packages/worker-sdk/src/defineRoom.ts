/**
 * defineRoom (GOAL.md §9.2) —— 创作者声明房间逻辑的入口。
 *
 * 创作者只面对 state / player / action / event / broadcast / send / timer /
 * random / log，完全不接触 seq / ack / transport / snapshot / postMessage (§9.1)。
 */

/** 房间内的玩家视图（创作者可见的精简结构） */
export interface RoomPlayer {
  id: string;
  name: string;
  role: 'host' | 'player' | 'spectator';
}

/** initialState 收到的初始上下文 */
export interface InitialContext {
  meta?: RoomMeta;
  manifest?: unknown;
}

/** 传给所有生命周期 / action 的房间上下文 (§9.3) */
export interface RoomContext<State = any> {
  /** 可变的权威状态草稿，直接修改即可 */
  state: State;
  /** 当前玩家列表 */
  players: RoomPlayer[];
  /** 房主 */
  host: RoomPlayer;

  now(): number;
  random(): number;

  broadcast(event: string, payload?: unknown): void;
  send(playerId: string, event: string, payload?: unknown): void;
  kick(playerId: string, reason?: string): void;
  log(...args: unknown[]): void;

  setTimer(name: string, ms: number, callback: () => void): void;
  clearTimer(name: string): void;
}

/** action handler (§9.4)。MVP 仅支持同步 handler (§9.4 备注)。 */
export type ActionHandler<State = any> = (
  ctx: RoomContext<State>,
  event: {
    player: RoomPlayer;
    payload: any;
    actionId: string;
  },
) => void;

export interface RoomMeta {
  name?: string;
  minPlayers?: number;
  maxPlayers?: number;
}

export interface RoomDefinition<State = any> {
  meta?: RoomMeta;
  initialState(ctx: InitialContext): State;
  onCreate?(ctx: RoomContext<State>): void;
  /**
   * 房间从持久化快照恢复时触发（房主刷新后），替代 onCreate。
   * 默认无需实现——重连/水合由 Runtime 全自动托管。
   */
  onRestore?(ctx: RoomContext<State>): void;
  onJoin?(ctx: RoomContext<State>, player: RoomPlayer): void;
  onLeave?(ctx: RoomContext<State>, player: RoomPlayer): void;
  onReady?(ctx: RoomContext<State>, player: RoomPlayer): void;
  /**
   * 某玩家断线后重连回归时触发（复用原玩家身份），不同于 onJoin。
   * 默认无需实现。
   */
  onReconnect?(ctx: RoomContext<State>, player: RoomPlayer): void;
  actions?: Record<string, ActionHandler<State>>;
}

/** 直接透传定义；存在的意义是提供类型推断与稳定 API 形态。 */
export function defineRoom<State>(
  definition: RoomDefinition<State>,
): RoomDefinition<State> {
  return definition;
}
