import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './categories';
import { WORD_PAIRS } from './word-bank';

describe('undercover word bank', () => {
  it('has 60 valid pairs in every category', () => {
    for (const category of CATEGORIES) {
      const pairs = WORD_PAIRS.filter((pair) => pair.category === category);
      expect(pairs, category).toHaveLength(60);
      expect(pairs.every((pair) => pair.civilian.trim() && pair.undercover.trim())).toBe(true);
      expect(pairs.every((pair) => pair.civilian !== pair.undercover)).toBe(true);
    }
  });

  it('does not contain duplicate IDs or unordered word pairs', () => {
    const ids = WORD_PAIRS.map((pair) => pair.id);
    const pairKeys = WORD_PAIRS.map((pair) => [pair.civilian, pair.undercover].sort().join('\u0000'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });
});
