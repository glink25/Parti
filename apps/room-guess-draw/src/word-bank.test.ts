import { describe, expect, it } from 'vitest';
import { WORD_BANK } from './word-bank';

describe('drawing word bank', () => {
  it('does not contain duplicate IDs or answers', () => {
    const entries = Object.values(WORD_BANK).flat();
    expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
    expect(new Set(entries.map(({ word }) => word)).size).toBe(entries.length);
  });
});
