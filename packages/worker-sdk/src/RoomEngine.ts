/**
 * RoomEngine —— 环境无关的房间逻辑执行核心。
 *
 * 持有权威 state + 玩家列表，运行创作者的生命周期/action handler，
 * 把副作用（broadcast/send/kick/log/state）通过 EngineEffects 抛出。
 *
 * 两种宿主复用它：
 *  - InProcessWorkerHost（测试 / Node，直接调用）
 *  - worker-entry（真实 Web Worker，经 postMessage 桥接）
 */
import {
  loadRoomDefinition,
} from './loader';
import type {
  InitialContext,
  RoomContext,
  RoomDefinition,
  RoomPlayer,
} from './defineRoom';

export interface EngineEffects {
  /** 每次输入处理完后回传当前权威 state */
  onState(state: unknown): void;
  onBroadcast(event: string, payload: unknown): void;
  onSend(playerId: string, event: string, payload: unknown): void;
  onKick(playerId: string, reason: string | undefined): void;
  onLog(args: unknown[]): void;
  onError(error: { message: string; stack?: string }): void;
}

export class RoomEngine {
  private readonly def: RoomDefinition;
  private readonly effects: EngineEffects;
  private state: unknown;
  private host!: RoomPlayer;
  private readonly players = new Map<string, RoomPlayer>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(source: string, effects: EngineEffects) {
    this.def = loadRoomDefinition(source);
    this.effects = effects;
  }

  init(host: RoomPlayer, manifest?: unknown, restoreState?: unknown): void {
    this.host = host;
    if (restoreState !== undefined) {
      // 从持久化快照水合：跳过 initialState，触发 onRestore 而非 onCreate。
      this.state = restoreState;
      this.run(() => this.def.onRestore?.(this.ctx()));
      return;
    }
    const initCtx: InitialContext = {
      ...(this.def.meta ? { meta: this.def.meta } : {}),
      manifest,
    };
    this.state = this.def.initialState(initCtx);
    this.run(() => this.def.onCreate?.(this.ctx()));
  }

  join(player: RoomPlayer): void {
    this.players.set(player.id, player);
    this.run(() => this.def.onJoin?.(this.ctx(), player));
  }

  /** 玩家重连回归：复用其身份，触发 onReconnect 而非 onJoin。 */
  reconnect(player: RoomPlayer): void {
    this.players.set(player.id, player);
    this.run(() => this.def.onReconnect?.(this.ctx(), player));
  }

  leave(player: RoomPlayer): void {
    this.run(() => this.def.onLeave?.(this.ctx(), player));
    this.players.delete(player.id);
  }

  ready(player: RoomPlayer): void {
    this.players.set(player.id, player);
    this.run(() => this.def.onReady?.(this.ctx(), player));
  }

  action(player: RoomPlayer, name: string, payload: unknown, actionId: string): void {
    const handler = this.def.actions?.[name];
    if (!handler) {
      this.effects.onError({ message: `未知 action: ${name}` });
      return;
    }
    this.run(() => handler(this.ctx(), { player, payload, actionId }));
  }

  dispose(): void {
    for (const h of this.timers.values()) clearTimeout(h);
    this.timers.clear();
  }

  /** 统一执行包装：捕获错误，并在结束后回传 state。 */
  private run(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.effects.onError({
        message: err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
    }
    this.effects.onState(this.state);
  }

  private ctx(): RoomContext {
    return {
      state: this.state as any,
      players: [...this.players.values()],
      host: this.host,
      now: () => Date.now(),
      random: () => Math.random(),
      broadcast: (event, payload) =>
        this.effects.onBroadcast(event, payload ?? null),
      send: (playerId, event, payload) =>
        this.effects.onSend(playerId, event, payload ?? null),
      kick: (playerId, reason) => this.effects.onKick(playerId, reason),
      log: (...args) => this.effects.onLog(args),
      setTimer: (timerName, ms, callback) =>
        this.setTimer(timerName, ms, callback),
      clearTimer: (timerName) => this.clearTimer(timerName),
    };
  }

  private setTimer(name: string, ms: number, callback: () => void): void {
    this.clearTimer(name);
    const handle = setTimeout(() => {
      this.timers.delete(name);
      this.run(callback);
    }, ms);
    this.timers.set(name, handle);
  }

  private clearTimer(name: string): void {
    const handle = this.timers.get(name);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(name);
    }
  }
}
