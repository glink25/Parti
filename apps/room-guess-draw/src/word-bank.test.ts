import { describe, expect, it } from 'vitest';
import { CATEGORY_DEFS, WORD_BANK } from './word-bank';

describe('drawing word bank', () => {
  it('has 30 valid prompts in every declared category', () => {
    expect(Object.keys(WORD_BANK).sort()).toEqual(CATEGORY_DEFS.map(({ id }) => id).sort());
    for (const { id } of CATEGORY_DEFS) {
      const entries = WORD_BANK[id as keyof typeof WORD_BANK];
      expect(entries, id).toHaveLength(30);
      expect(entries.every((entry) => entry.word.trim() && entry.hints.length === 2 && entry.hints.every(Boolean))).toBe(true);
    }
  });

  it('does not contain duplicate IDs or answers', () => {
    const entries = Object.values(WORD_BANK).flat();
    expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
    expect(new Set(entries.map(({ word }) => word)).size).toBe(entries.length);
  });
});
