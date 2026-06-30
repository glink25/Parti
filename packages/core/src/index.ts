/** @parti/core —— 协议类型 + Runtime 引擎 + 抽象接口 */

// 协议
export * from './protocol/messages.js';
export * from './protocol/factory.js';

// Transport 抽象
export * from './transport/types.js';

// 错误
export * from './errors.js';

// 玩家
export * from './players.js';

// 状态同步
export * from './state/hash.js';
export * from './state/sync.js';

// 会话持久化 / 重连
export * from './session/SessionStore.js';

// Runtime
export * from './runtime/types.js';
export * from './runtime/admission.js';
export * from './runtime/worker-host.js';
export { HostRuntime } from './runtime/HostRuntime.js';
export type { HostRuntimeOptions } from './runtime/HostRuntime.js';
export { ClientRuntime } from './runtime/ClientRuntime.js';
export type { ClientRuntimeOptions } from './runtime/ClientRuntime.js';

// 工具
export * from './util/emitter.js';

/** Parti Runtime 版本 (§14) */
export const PARTI_VERSION = '0.1.0';
