/**
 * 用 Vite 的 `?worker` 机制把 @parti/worker-sdk 的 worker-entry 实例化为真实
 * Web Worker，注入到 WebWorkerHost。房间逻辑因此运行在独立 Worker 沙箱中 (§12.2)。
 */
import RoomWorker from '@parti/worker-sdk/worker-entry?worker';
import { WebWorkerHost } from '@parti/worker-sdk';

export function createWebWorkerHost(): WebWorkerHost {
  return new WebWorkerHost(() => new RoomWorker());
}
