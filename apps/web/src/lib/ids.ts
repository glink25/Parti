import { v4 as uuidv4 } from 'uuid';

/** 生成带前缀的短 id（房间/模版唯一标识）。 */
export function createDraftId(prefix = 'room'): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}
