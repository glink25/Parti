/**
 * Room Package 内容寻址哈希 (GOAL.md §11.1)。
 *
 * packageHash = sha256(stableStringify(manifest) + 排序后的文件内容)。
 * 用于：玩家校验收到的代码与房主一致、主机迁移确认、缓存与版本管理。
 *
 * 使用真正的 SubtleCrypto sha256（区别于 state 的轻量哈希）。
 */
import { stableStringify } from '@parti/core';

export async function hashPackage(
  manifest: unknown,
  files: Record<string, Uint8Array>,
): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(stableStringify(manifest))];
  for (const name of Object.keys(files).sort()) {
    parts.push(encoder.encode(`\n@@${name}@@\n`), files[name]);
  }
  return sha256BytesHex(concatBytes(parts));
}

export async function sha256Hex(text: string): Promise<string> {
  return sha256BytesHex(new TextEncoder().encode(text));
}

export async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
