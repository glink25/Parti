import { describe, expect, it } from 'vitest';
import {
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
} from './game-logic';
import type { WordPair } from './words';

const PAIRS: WordPair[] = [
  { id: 'daily-1', category: 'daily', civilian: '杯子', undercover: '碗' },
  { id: 'daily-2', category: 'daily', civilian: '牙刷', undercover: '梳子' },
  { id: 'weapons-1', category: 'weapons', civilian: '长剑', undercover: '短剑' },
];

describe('undercoverCount', () => {
  it.each([[2, 0], [3, 1], [5, 1], [6, 2], [9, 2], [10, 3], [12, 3]])('maps %i players to %i undercover players', (players, expected) => {
    expect(undercoverCount(players)).toBe(expected);
  });
});

describe('categories', () => {
  it('accepts unique known categories and rejects invalid or empty values', () => {
    expect(normalizeCategories(['daily', 'daily', 'weapons'])).toEqual(['daily', 'weapons']);
    expect(normalizeCategories([])).toBeNull();
    expect(normalizeCategories(['unknown'])).toBeNull();
  });

  it('filters pairs by every selected category', () => {
    expect(eligiblePairs(PAIRS, ['daily']).map(({ id }) => id)).toEqual(['daily-1', 'daily-2']);
    expect(eligiblePairs(PAIRS, ['daily', 'weapons'])).toHaveLength(3);
  });
});

describe('choosePair', () => {
  it('does not repeat before exhaustion and reports the reset', () => {
    const used = new Set(['daily-1']);
    expect(choosePair(PAIRS.slice(0, 2), used, () => 0).pair.id).toBe('daily-2');
    used.add('daily-2');
    const next = choosePair(PAIRS.slice(0, 2), used, () => 0);
    expect(next.reset).toBe(true);
    expect(next.pair.id).toBe('daily-1');
  });
});

describe('dealCards', () => {
  it('deals exactly one card per player with the automatic role count', () => {
    const players = Array.from({ length: 6 }, (_, index) => `p${index}`);
    const cards = dealCards(players, PAIRS[0], () => 0.99);
    expect(Object.keys(cards)).toEqual(players);
    expect(Object.values(cards).filter(({ role }) => role === 'undercover')).toHaveLength(2);
    expect(new Set(Object.values(cards).map(({ word }) => word))).toEqual(new Set(['杯子', '碗']));
  });

  it('can swap which side of the pair is assigned to civilians', () => {
    const players = ['a', 'b', 'c'];
    const normal = dealCards(players, PAIRS[0], () => 0.99);
    const swapped = dealCards(players, PAIRS[0], () => 0);
    const civilianWord = (cards: typeof normal) => Object.values(cards).find(({ role }) => role === 'civilian')?.word;
    expect(civilianWord(normal)).toBe('杯子');
    expect(civilianWord(swapped)).toBe('碗');
  });
});

describe('hidden roles and elimination', () => {
  const cards = {
    civilianA: { role: 'civilian' as const, word: '杯子' },
    civilianB: { role: 'civilian' as const, word: '杯子' },
    undercoverA: { role: 'undercover' as const, word: '碗' },
    undercoverB: { role: 'undercover' as const, word: '碗' },
  };

  it('projects a private card without exposing its role', () => {
    expect(privateCardPayload(cards.undercoverA, 4)).toEqual({ round: 4, word: '碗' });
    expect(privateCardPayload(cards.undercoverA, 4)).not.toHaveProperty('role');
  });

  it('continues after a civilian or only some undercover players are eliminated', () => {
    expect(resolveElimination(cards, ['civilianA'])).toEqual({ finished: false, revealedWords: null });
    expect(resolveElimination(cards, ['undercoverA'])).toEqual({ finished: false, revealedWords: null });
  });

  it('finishes and reveals both words after every undercover player is eliminated', () => {
    expect(resolveElimination(cards, ['civilianA', 'undercoverA', 'undercoverB'])).toEqual({
      finished: true,
      revealedWords: { civilian: '杯子', undercover: '碗' },
    });
  });
});

describe('deal modes', () => {
  const players = [
    { id: 'host', role: 'host' as const },
    { id: 'a', role: 'player' as const },
    { id: 'b', role: 'player' as const },
    { id: 'c', role: 'player' as const },
    { id: 'watching', role: 'spectator' as const },
  ];

  it('includes the host in classic mode and excludes them from moderated modes', () => {
    expect(participantIds(players, 'classic')).toEqual(['host', 'a', 'b', 'c']);
    expect(participantIds(players, 'blank')).toEqual(['a', 'b', 'c']);
    expect(participantIds(players, 'custom')).toEqual(['a', 'b', 'c']);
  });

  it('deals blank cards only to undercover players', () => {
    const cards = dealCardsWithWords(
      ['a', 'b', 'c'],
      { civilian: '咖啡', undercover: '' },
      () => 0.99,
    );
    expect(Object.values(cards).filter(({ role }) => role === 'undercover')).toHaveLength(1);
    expect(Object.values(cards).filter(({ role }) => role === 'undercover')[0].word).toBe('');
    expect(Object.values(cards).filter(({ role }) => role === 'civilian').every(({ word }) => word === '咖啡')).toBe(true);
  });

  it('keeps custom civilian and undercover directions fixed', () => {
    const cards = dealCardsWithWords(
      ['a', 'b', 'c'],
      { civilian: '咖啡', undercover: '奶茶' },
      () => 0.99,
    );
    expect(Object.values(cards).find(({ role }) => role === 'civilian')?.word).toBe('咖啡');
    expect(Object.values(cards).find(({ role }) => role === 'undercover')?.word).toBe('奶茶');
  });

  it('normalizes valid custom words and rejects empty, identical, or overlong input', () => {
    expect(normalizeCustomWords({ civilianWord: ' 咖啡 ', undercoverWord: ' 奶茶 ' })).toEqual({ civilian: '咖啡', undercover: '奶茶' });
    expect(normalizeCustomWords({ civilianWord: '', undercoverWord: '奶茶' })).toBeNull();
    expect(normalizeCustomWords({ civilianWord: '咖啡', undercoverWord: '咖啡' })).toBeNull();
    expect(normalizeCustomWords({ civilianWord: '一'.repeat(21), undercoverWord: '奶茶' })).toBeNull();
  });

  it('finishes blank mode with an empty undercover reveal', () => {
    const cards = {
      a: { role: 'undercover' as const, word: '' },
      b: { role: 'civilian' as const, word: '咖啡' },
      c: { role: 'civilian' as const, word: '咖啡' },
    };
    expect(resolveElimination(cards, ['a'])).toEqual({
      finished: true,
      revealedWords: { civilian: '咖啡', undercover: '' },
    });
  });
});
