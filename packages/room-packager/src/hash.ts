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
  files: Record<string, string>,
): Promise<string> {
  const parts: string[] = [stableStringify(manifest)];
  for (const name of Object.keys(files).sort()) {
    parts.push(`\n@@${name}@@\n`, files[name]);
  }
  return sha256Hex(parts.join(''));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
