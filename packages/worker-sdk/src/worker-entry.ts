/**
 * worker-entry —— 运行在真实 Web Worker 内的引导脚本 (§12.2)。
 *
 * 接收主线程的 init（含 room.worker.js 源码），用 RoomEngine 求值并运行，
 * 把副作用经 postMessage 回流。房间代码默认不可信，Worker 提供沙箱边界：
 * 无 DOM、无平台 token、无主站访问。
 *
 * 该文件被 apps/web 以 `?worker` 方式实例化为 Worker。
 */
import { RoomEngine, type EngineEffects } from './RoomEngine.js';
import type { MainToWorker, WorkerToMain } from './bridge.js';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let engine: RoomEngine | undefined;

function post(message: WorkerToMain): void {
  ctx.postMessage(message);
}

const effects: EngineEffects = {
  onState: (state) => post({ kind: 'state', state }),
  onBroadcast: (event, payload) => post({ kind: 'broadcast', event, payload }),
  onSend: (playerId, event, payload) =>
    post({ kind: 'send', playerId, event, payload }),
  onKick: (playerId, reason) => post({ kind: 'kick', playerId, reason }),
  onLog: (args) => post({ kind: 'log', args }),
  onError: (error) => post({ kind: 'error', error }),
};

ctx.onmessage = (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.kind) {
      case 'init':
        engine = new RoomEngine(msg.roomSource, effects);
        engine.init(msg.host, msg.manifest, msg.restoreState);
        post({ kind: 'init-ack' });
        break;
      case 'join':
        engine?.join(msg.player);
        break;
      case 'reconnect':
        engine?.reconnect(msg.player);
        break;
      case 'leave':
        engine?.leave(msg.player);
        break;
      case 'ready':
        engine?.ready(msg.player);
        break;
      case 'action':
        engine?.action(msg.player, msg.action, msg.payload, msg.actionId);
        break;
      case 'dispose':
        engine?.dispose();
        engine = undefined;
        break;
    }
  } catch (err) {
    post({
      kind: 'error',
      error: {
        message: err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      },
    });
  }
};
