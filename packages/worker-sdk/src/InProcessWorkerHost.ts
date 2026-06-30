/**
 * InProcessWorkerHost —— 在同一线程内运行 RoomEngine 的 RoomWorkerHost 实现。
 *
 * 用于单元测试 / Node 环境（无法 spawn DOM Worker），以及需要可调试同步执行
 * 的场景。生产浏览器使用 WebWorkerHost 真正沙箱化。
 */
import type { Player, RoomWorkerHost, RoomWorkerCallbacks, WorkerInitOptions } from '@parti/core';
import type { RoomPlayer } from './defineRoom.js';
import { RoomEngine, type EngineEffects } from './RoomEngine.js';

function toRoomPlayer(p: Player): RoomPlayer {
  return { id: p.id, name: p.name, role: p.role };
}

export class InProcessWorkerHost implements RoomWorkerHost {
  private engine?: RoomEngine;
  private callbacks?: RoomWorkerCallbacks;

  setCallbacks(callbacks: RoomWorkerCallbacks): void {
    this.callbacks = callbacks;
  }

  async init(options: WorkerInitOptions): Promise<void> {
    const effects: EngineEffects = {
      onState: (state) => this.callbacks?.onState(state),
      onBroadcast: (event, payload) => this.callbacks?.onBroadcast(event, payload),
      onSend: (playerId, event, payload) =>
        this.callbacks?.onSend(playerId, event, payload),
      onKick: (playerId, reason) => this.callbacks?.onKick(playerId, reason),
      onLog: (args) => this.callbacks?.onLog(args),
      onError: (error) => this.callbacks?.onError(error),
    };
    this.engine = new RoomEngine(options.roomSource, effects);
    this.engine.init(toRoomPlayer(options.host), options.manifest, options.restoreState);
  }

  join(player: Player): void {
    this.engine?.join(toRoomPlayer(player));
  }

  reconnect(player: Player): void {
    this.engine?.reconnect(toRoomPlayer(player));
  }

  leave(player: Player): void {
    this.engine?.leave(toRoomPlayer(player));
  }

  ready(player: Player): void {
    this.engine?.ready(toRoomPlayer(player));
  }

  dispatchAction(player: Player, action: string, payload: unknown, actionId: string): void {
    this.engine?.action(toRoomPlayer(player), action, payload, actionId);
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = undefined;
  }
}
