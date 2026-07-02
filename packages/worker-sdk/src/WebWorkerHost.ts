/**
 * WebWorkerHost —— 在真实 Web Worker 中运行房间逻辑的 RoomWorkerHost 实现 (§12.2)。
 *
 * 不直接 new Worker（跨包 URL 解析不稳定），改由调用方注入 workerFactory，
 * 以便 apps/web 用 Vite 的 `?worker` 机制实例化 worker-entry：
 *
 *   import RoomWorker from '@parti/worker-sdk/worker-entry?worker';
 *   new WebWorkerHost(() => new RoomWorker());
 */
import type {
  Player,
  RoomWorkerHost,
  RoomWorkerCallbacks,
  WorkerInitOptions,
} from '@parti/core';
import type { RoomPlayer } from './defineRoom';
import type { MainToWorker, WorkerToMain } from './bridge';

function toRoomPlayer(p: Player): RoomPlayer {
  return { id: p.id, name: p.name, role: p.role };
}

export type WorkerFactory = () => Worker;

export class WebWorkerHost implements RoomWorkerHost {
  private worker?: Worker;
  private callbacks?: RoomWorkerCallbacks;
  private readonly factory: WorkerFactory;

  constructor(factory: WorkerFactory) {
    this.factory = factory;
  }

  setCallbacks(callbacks: RoomWorkerCallbacks): void {
    this.callbacks = callbacks;
  }

  async init(options: WorkerInitOptions): Promise<void> {
    const worker = this.factory();
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.onWorkerMessage(e.data);
    worker.onerror = (e) =>
      this.callbacks?.onError({ message: e.message || 'worker error' });

    await new Promise<void>((resolve) => {
      const onReady = (e: MessageEvent<WorkerToMain>) => {
        if (e.data.kind === 'init-ack') {
          worker.removeEventListener('message', onReady);
          resolve();
        }
      };
      worker.addEventListener('message', onReady);
      this.post({
        kind: 'init',
        roomId: options.roomId,
        roomSource: options.roomSource,
        manifest: options.manifest,
        host: toRoomPlayer(options.host),
        restoreState: options.restoreState,
      });
    });
  }

  join(player: Player): void {
    this.post({ kind: 'join', player: toRoomPlayer(player) });
  }
  reconnect(player: Player): void {
    this.post({ kind: 'reconnect', player: toRoomPlayer(player) });
  }
  leave(player: Player): void {
    this.post({ kind: 'leave', player: toRoomPlayer(player) });
  }
  ready(player: Player): void {
    this.post({ kind: 'ready', player: toRoomPlayer(player) });
  }
  dispatchAction(player: Player, action: string, payload: unknown, actionId: string): void {
    this.post({ kind: 'action', player: toRoomPlayer(player), action, payload, actionId });
  }

  dispose(): void {
    this.post({ kind: 'dispose' });
    this.worker?.terminate();
    this.worker = undefined;
  }

  private post(message: MainToWorker): void {
    this.worker?.postMessage(message);
  }

  private onWorkerMessage(msg: WorkerToMain): void {
    const cb = this.callbacks;
    if (!cb) return;
    switch (msg.kind) {
      case 'state':
        cb.onState(msg.state);
        break;
      case 'broadcast':
        cb.onBroadcast(msg.event, msg.payload);
        break;
      case 'send':
        cb.onSend(msg.playerId, msg.event, msg.payload);
        break;
      case 'kick':
        cb.onKick(msg.playerId, msg.reason);
        break;
      case 'log':
        cb.onLog(msg.args);
        break;
      case 'error':
        cb.onError(msg.error);
        break;
      case 'init-ack':
        break;
    }
  }
}
