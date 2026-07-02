/** @parti/core —— 协议类型 + Runtime 引擎 + 抽象接口 */

// 协议
export * from './protocol/messages';
export * from './protocol/factory';

// Transport 抽象
export * from './transport/types';

// 错误
export * from './errors';

// 玩家
export * from './players';

// 状态同步
export * from './state/hash';
export * from './state/sync';

// 会话持久化 / 重连
export * from './session/SessionStore';

// Runtime
export * from './runtime/types';
export * from './runtime/admission';
export * from './runtime/worker-host';
export { HostRuntime } from './runtime/HostRuntime';
export type { HostRuntimeOptions } from './runtime/HostRuntime';
export { ClientRuntime } from './runtime/ClientRuntime';
export type { ClientRuntimeOptions } from './runtime/ClientRuntime';

// 工具
export * from './util/emitter';

/** Parti Runtime 版本 (§14) */
export const PARTI_VERSION = '0.1.0';
