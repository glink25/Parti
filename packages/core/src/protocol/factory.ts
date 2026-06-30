/**
 * RoomMessage 工厂 —— 负责生成 envelope，管理连接内 seq 自增。
 * 创作者不接触这一层 (§9.1)；Runtime 内部使用。
 */
import type { Channel, RoomMessage } from './messages.js';

let idCounter = 0;

/** 生成消息唯一 ID。优先 crypto.randomUUID，回退到计数器。 */
export function generateId(prefix = 'msg'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/**
 * SeqCounter —— 维护单条连接的递增序号 (envelope.seq)。
 * 每个 TransportSession 持有一个。
 */
export class SeqCounter {
  private value = 0;

  next(): number {
    this.value += 1;
    return this.value;
  }

  current(): number {
    return this.value;
  }
}

export interface CreateMessageInput<T> {
  roomId: string;
  from: string;
  to?: string;
  seq: number;
  ack?: number;
  channel: Channel;
  type: string;
  payload: T;
}

/** 构造一条标准 RoomMessage。 */
export function createMessage<T>(input: CreateMessageInput<T>): RoomMessage<T> {
  const message: RoomMessage<T> = {
    v: 1,
    id: generateId(),
    roomId: input.roomId,
    from: input.from,
    seq: input.seq,
    channel: input.channel,
    type: input.type,
    ts: Date.now(),
    payload: input.payload,
  };
  if (input.to !== undefined) message.to = input.to;
  if (input.ack !== undefined) message.ack = input.ack;
  return message;
}
