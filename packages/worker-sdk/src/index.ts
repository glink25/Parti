/** @parti/worker-sdk —— 创作者 API + 房间逻辑执行宿主 */
export { defineRoom } from './defineRoom.js';
export type {
  RoomDefinition,
  RoomContext,
  RoomPlayer,
  RoomMeta,
  ActionHandler,
  InitialContext,
} from './defineRoom.js';

export { RoomEngine } from './RoomEngine.js';
export type { EngineEffects } from './RoomEngine.js';
export { loadRoomDefinition } from './loader.js';

export { InProcessWorkerHost } from './InProcessWorkerHost.js';
export { WebWorkerHost } from './WebWorkerHost.js';
export type { WorkerFactory } from './WebWorkerHost.js';
