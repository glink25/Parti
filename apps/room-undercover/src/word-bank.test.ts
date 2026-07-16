import { describe, expect, it } from 'vitest';
import { WORD_PAIRS } from './word-bank';

describe('undercover word bank', () => {
  it('does not contain duplicate IDs or unordered word pairs', () => {
    const ids = WORD_PAIRS.map((pair) => pair.id);
    const pairKeys = WORD_PAIRS.map((pair) => [pair.civilian, pair.undercover].sort().join('\u0000'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });
});
