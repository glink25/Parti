/** Runtime 共享类型 + DevTools 事件 */
import type { RoomMessage } from '../protocol/messages.js';

/** 消息日志条目（DevTools §15.1） */
export interface MessageLogEntry {
  dir: 'in' | 'out';
  message: RoomMessage;
  at: number;
}

/** Transport 连接状态 */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error';
