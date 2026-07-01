import { v4 as uuidv4 } from 'uuid';

/** 不依赖 crypto.randomUUID，兼容缺少该 API 的 WebView 与旧浏览器。 */
export function createReplayId(): string {
  return `replay-${uuidv4()}`;
}
