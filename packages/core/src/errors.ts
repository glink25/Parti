/** 统一房间错误 (GOAL.md §8.12) */
import type { RoomErrorCode, RoomErrorPayload } from './protocol/messages.js';

export class RoomError extends Error {
  readonly code: RoomErrorCode;
  readonly recoverable: boolean;
  readonly detail?: unknown;

  constructor(
    code: RoomErrorCode,
    message: string,
    options: { recoverable?: boolean; detail?: unknown } = {},
  ) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.detail = options.detail;
  }

  toPayload(): RoomErrorPayload {
    const payload: RoomErrorPayload = {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    };
    if (this.detail !== undefined) payload.detail = this.detail;
    return payload;
  }
}
