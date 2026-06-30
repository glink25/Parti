/**
 * Room 源码加载器 —— 把 room.worker.js 文本动态求值为 RoomDefinition (§11)。
 *
 * MVP 策略（轻量模块 shim，无打包器）：
 *  1. 移除对 '@parti/worker-sdk' 的 import 语句。
 *  2. 把 `export default X` 改写为 `__parti_exports.default = X`。
 *  3. 用 new Function 注入 defineRoom 与一个 exports 容器后求值。
 *
 * 这在房主浏览器的 Worker 内运行，房间代码默认不可信，因此 Worker 自身已被
 * 沙箱限制（无网络/存储授权，§12.2）。后续可替换为真正的打包/ESM import。
 */
import { defineRoom, type RoomDefinition } from './defineRoom.js';

export function loadRoomDefinition(source: string): RoomDefinition {
  const transformed = transformSource(source);
  const exportsContainer: { default?: RoomDefinition } = {};
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'defineRoom',
    '__parti_exports',
    'exports',
    transformed,
  );
  factory(defineRoom, exportsContainer, exportsContainer);

  const def = exportsContainer.default;
  if (!def || typeof def.initialState !== 'function') {
    throw new Error('room.worker.js 必须 export default defineRoom({...})');
  }
  return def;
}

function transformSource(source: string): string {
  let out = source;
  // 移除 `import { defineRoom } from '@parti/worker-sdk'` 等导入（defineRoom 由外部注入）
  out = out.replace(
    /^\s*import\s+[^;]*?from\s*['"][^'"]*worker[^'"]*['"]\s*;?\s*$/gm,
    '',
  );
  out = out.replace(
    /^\s*import\s+[^;]*?from\s*['"]@parti\/[^'"]*['"]\s*;?\s*$/gm,
    '',
  );
  // export default -> 容器赋值
  out = out.replace(/export\s+default\s+/g, '__parti_exports.default = ');
  return out;
}
