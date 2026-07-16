import { describe, expect, it } from 'vitest';
import {
  blankAppearanceChance,
  choosePair,
  dealCards,
  dealCardsWithWords,
  eligiblePairs,
  normalizeCategories,
  normalizeCustomWords,
  participantIds,
  privateCardPayload,
  resolveElimination,
  undercoverCount,
  type DealResult,
} from './game-logic';
import type { WordPair } from './word-bank';

const PAIRS: WordPair[] = [
  { id: 'daily-1', category: 'daily', civilian: '杯子', undercover: '碗' },
  { id: 'daily-2', category: 'daily', civilian: '牙刷', undercover: '梳子' },
  { id: 'food-1', category: 'food', civilian: '牛奶', undercover: '豆浆' },
];
const WORDS = { civilian: '杯子', undercover: '碗' };

describe('role counts', () => {
  it.each([[2, 0], [3, 1], [5, 1], [6, 2], [9, 2], [10, 3], [12, 3]])('maps %i players to %i undercover slots', (players, expected) => {
    expect(undercoverCount(players)).toBe(expected);
  });

  it.each([[2, 0], [3, 0.25], [4, 0.5], [5, 0.75], [6, 1], [12, 1]])('maps %i players to blank chance %i', (players, expected) => {
    expect(blankAppearanceChance(players)).toBe(expected);
  });
});

describe('categories and pairs', () => {
  it('normalizes categories and filters pairs', () => {
    expect(normalizeCategories(['daily', 'daily', 'food'])).toEqual(['daily', 'food']);
    expect(normalizeCategories([])).toBeNull();
    expect(normalizeCategories(['unknown'])).toBeNull();
    expect(eligiblePairs(PAIRS, ['daily']).map(({ id }) => id)).toEqual(['daily-1', 'daily-2']);
  });

  it('does not repeat pairs before exhaustion', () => {
    const used = new Set(['daily-1']);
    expect(choosePair(PAIRS.slice(0, 2), used, () => 0).pair.id).toBe('daily-2');
    used.add('daily-2');
    expect(choosePair(PAIRS.slice(0, 2), used, () => 0)).toMatchObject({ reset: true, pair: { id: 'daily-1' } });
  });
});

describe('dealing', () => {
  it('keeps the existing undercover distribution without a blank', () => {
    const players = Array.from({ length: 6 }, (_, index) => `p${index}`);
    const deal = dealCards(players, PAIRS[0], () => 0.99);
    expect(Object.keys(deal.cards)).toEqual(players);
    expect(Object.values(deal.cards).filter(({ role }) => role === 'undercover')).toHaveLength(2);
    expect(Object.values(deal.cards).filter(({ role }) => role === 'blank')).toHaveLength(0);
    expect(deal).toMatchObject({ hadBlank: false, hadUndercover: true });
  });

  it.each([
    [4, 0.49, 2, 1, 1],
    [5, 0.74, 3, 1, 1],
    [6, 0.99, 4, 1, 1],
    [10, 0.99, 7, 2, 1],
  ])('deals %i players with the expected three-role distribution', (count, blankRoll, civilians, undercovers, blanks) => {
    const players = Array.from({ length: count }, (_, index) => `p${index}`);
    const values = [blankRoll, ...Array(count).fill(0.99)];
    const deal = dealCardsWithWords(players, WORDS, () => values.shift() ?? 0.99, true);
    expect(Object.values(deal.cards).filter(({ role }) => role === 'civilian')).toHaveLength(civilians);
    expect(Object.values(deal.cards).filter(({ role }) => role === 'undercover')).toHaveLength(undercovers);
    expect(Object.values(deal.cards).filter(({ role }) => role === 'blank')).toHaveLength(blanks);
    expect(Object.values(deal.cards).find(({ role }) => role === 'blank')?.word).toBe('');
  });

  it('supports the three-player blank raid and a missed random roll', () => {
    const players = ['a', 'b', 'c'];
    const raid = dealCardsWithWords(players, WORDS, () => 0, true);
    expect(Object.values(raid.cards).filter(({ role }) => role === 'blank')).toHaveLength(1);
    expect(Object.values(raid.cards).filter(({ role }) => role === 'undercover')).toHaveLength(0);
    const normal = dealCardsWithWords(players, WORDS, () => 0.25, true);
    expect(Object.values(normal.cards).filter(({ role }) => role === 'blank')).toHaveLength(0);
    expect(Object.values(normal.cards).filter(({ role }) => role === 'undercover')).toHaveLength(1);
  });

  it('keeps the private card payload free of role information', () => {
    const card = { role: 'blank' as const, word: '' };
    expect(privateCardPayload(card, 4)).toEqual({ round: 4, word: '' });
    expect(privateCardPayload(card, 4)).not.toHaveProperty('role');
  });
});

describe('victory resolution', () => {
  function deal(cards: DealResult['cards'], hadBlank = false): DealResult {
    return { cards, words: WORDS, hadBlank, hadUndercover: Object.values(cards).some(({ role }) => role === 'undercover') };
  }

  it('continues while civilians still outnumber living undercovers', () => {
    const current = deal({
      c1: { role: 'civilian', word: '杯子' }, c2: { role: 'civilian', word: '杯子' },
      c3: { role: 'civilian', word: '杯子' }, u1: { role: 'undercover', word: '碗' },
    });
    expect(resolveElimination(current, ['c1'])).toMatchObject({ finished: false, winner: null, revealedWords: null });
  });

  it('awards undercovers when living civilian and undercover counts are tied', () => {
    const current = deal({
      c1: { role: 'civilian', word: '杯子' }, c2: { role: 'civilian', word: '杯子' },
      u1: { role: 'undercover', word: '碗' }, b1: { role: 'blank', word: '' },
    }, true);
    expect(resolveElimination(current, ['c1'])).toMatchObject({ finished: true, winner: 'undercover', revealedWords: WORDS });
  });

  it('awards the blank when the last undercover dies while the blank survives', () => {
    const current = deal({ c1: { role: 'civilian', word: '杯子' }, u1: { role: 'undercover', word: '碗' }, b1: { role: 'blank', word: '' } }, true);
    expect(resolveElimination(current, ['u1'])).toMatchObject({ finished: true, winner: 'blank', revealedWords: WORDS });
  });

  it('awards civilians when every undercover and blank is dead', () => {
    const current = deal({ c1: { role: 'civilian', word: '杯子' }, u1: { role: 'undercover', word: '碗' }, b1: { role: 'blank', word: '' } }, true);
    expect(resolveElimination(current, ['u1', 'b1'])).toMatchObject({ finished: true, winner: 'civilian', revealedWords: WORDS });
  });

  it('resolves the first elimination in a three-player blank raid', () => {
    const current = deal({ c1: { role: 'civilian', word: '杯子' }, c2: { role: 'civilian', word: '杯子' }, b1: { role: 'blank', word: '' } }, true);
    expect(resolveElimination(current, ['b1'])).toMatchObject({ winner: 'civilian' });
    expect(resolveElimination(current, ['c1'])).toMatchObject({ winner: 'blank' });
  });
});

describe('deal settings', () => {
  const players = [
    { id: 'host', role: 'host' as const }, { id: 'a', role: 'player' as const },
    { id: 'b', role: 'player' as const }, { id: 'c', role: 'player' as const },
    { id: 'watching', role: 'spectator' as const },
  ];

  it('includes the host for classic words and excludes them for host-authored custom words', () => {
    expect(participantIds(players, 'classic')).toEqual(['host', 'a', 'b', 'c']);
    expect(participantIds(players, 'custom')).toEqual(['a', 'b', 'c']);
  });

  it('normalizes valid custom words and rejects invalid input', () => {
    expect(normalizeCustomWords({ civilianWord: ' 咖啡 ', undercoverWord: ' 奶茶 ' })).toEqual({ civilian: '咖啡', undercover: '奶茶' });
    expect(normalizeCustomWords({ civilianWord: '', undercoverWord: '奶茶' })).toBeNull();
    expect(normalizeCustomWords({ civilianWord: '咖啡', undercoverWord: '咖啡' })).toBeNull();
    expect(normalizeCustomWords({ civilianWord: '一'.repeat(21), undercoverWord: '奶茶' })).toBeNull();
  });
});
