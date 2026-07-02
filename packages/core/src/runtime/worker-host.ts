/**
 * RoomWorkerHost —— Runtime 与 Room Worker 之间的抽象边界。
 *
 * core 只定义接口，不关心 worker 如何 spawn（new Worker、in-process 等由
 * @parti/worker-sdk 提供具体实现）。这样 HostRuntime 不依赖任何环境特定 API，
 * 也符合 §9.1：内部桥协议对创作者不可见。
 */
import type { Player } from '../players';

/** worker 在处理某个输入后产生的副作用回调 */
export interface RoomWorkerCallbacks {
  /** 权威 state 发生变化（worker 持有 state，回传完整快照源） */
  onState(state: unknown): void;
  /** room.broadcast(event, payload) */
  onBroadcast(event: string, payload: unknown): void;
  /** room.send(playerId, event, payload) */
  onSend(playerId: string, event: string, payload: unknown): void;
  /** room.kick(playerId, reason) */
  onKick(playerId: string, reason: string | undefined): void;
  /** room.log(...args) */
  onLog(args: unknown[]): void;
  /** worker 内运行时错误 */
  onError(error: { message: string; stack?: string }): void;
}

export interface WorkerInitOptions {
  roomId: string;
  /** room.worker.js 源码字符串（动态加载，§11） */
  roomSource: string;
  /** 房间基础配置，传给 initialState/meta */
  manifest?: unknown;
  /** host 玩家信息 */
  host: Player;
  /**
   * 可选：从持久化快照恢复的权威 state（房主刷新后水合）。提供时跳过
   * initialState()，改用该 state，并触发创作者可选的 onRestore 钩子。
   */
  restoreState?: unknown;
}

/**
 * 主线程侧的 worker 句柄。HostRuntime 通过它驱动房间逻辑。
 * 所有方法均为「投递输入」，副作用通过 callbacks 异步回流。
 */
export interface RoomWorkerHost {
  setCallbacks(callbacks: RoomWorkerCallbacks): void;
  init(options: WorkerInitOptions): Promise<void>;

  join(player: Player): void;
  /** 玩家断线后重连回归（复用原身份，触发 onReconnect 而非 onJoin）。 */
  reconnect(player: Player): void;
  leave(player: Player): void;
  ready(player: Player): void;
  dispatchAction(
    player: Player,
    action: string,
    payload: unknown,
    actionId: string,
  ): void;

  dispose(): void;
}
