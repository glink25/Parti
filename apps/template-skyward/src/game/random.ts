export type Random = { float(): number; int(min: number, max: number): number; pick<T>(items: readonly T[]): T };

function hashText(text: string) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function scopedSeed(runSeed: number, chunk: number, channel: string) {
  return hashText(`${runSeed >>> 0}:${chunk}:${channel}`);
}

export function createRandom(seed: number): Random {
  let value = seed >>> 0;
  const float = () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
  return {
    float,
    int(min, max) { return Math.floor(float() * (max - min + 1)) + min; },
    pick<T>(items: readonly T[]) { return items[Math.floor(float() * items.length)]!; },
  };
}
