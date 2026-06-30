/**
 * 轻量状态哈希 (MVP) —— 用于 state:hash 去重与一致性校验 (§13.2)。
 *
 * 注意：这是非加密哈希 (FNV-1a)，仅用于状态快照比对。
 * Room Package 的内容寻址 packageHash 使用真正的 SubtleCrypto sha256，
 * 见 @parti/room-packager。
 */

/** 对任意 JSON 可序列化值计算稳定哈希。键顺序无关。 */
export function stateHash(value: unknown): string {
  const json = stableStringify(value);
  return fnv1a(json);
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime 乘法，用移位避免溢出丢精度
    h = Math.imul(h, 0x01000193);
  }
  // 转为无符号 32-bit hex
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 稳定序列化：对象键排序，保证哈希与键插入顺序无关。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
