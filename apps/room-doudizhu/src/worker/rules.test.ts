import { describe, expect, it } from 'vitest';
import { analyzePlay, canBeat } from './rules';
import type { Card } from './types';

function cards(...ranks: number[]): Card[] {
  return ranks.map((rank, index) => ({
    id: `${rank}-${index}`,
    suit: rank >= 16 ? 'joker' : 'spades',
    rank,
    label: String(rank),
  }));
}

describe('doudizhu rules', () => {
  it('recognizes common play types', () => {
    expect(analyzePlay(cards(7))?.type).toBe('single');
    expect(analyzePlay(cards(7, 7))?.type).toBe('pair');
    expect(analyzePlay(cards(7, 7, 7, 9))?.type).toBe('triple-single');
    expect(analyzePlay(cards(7, 7, 7, 9, 9))?.type).toBe('triple-pair');
    expect(analyzePlay(cards(3, 4, 5, 6, 7))?.type).toBe('straight');
    expect(analyzePlay(cards(3, 3, 4, 4, 5, 5))?.type).toBe('pair-straight');
    expect(analyzePlay(cards(6, 6, 6, 7, 7, 7))?.type).toBe('airplane');
    expect(analyzePlay(cards(9, 9, 9, 9))?.type).toBe('bomb');
    expect(analyzePlay(cards(16, 17))?.type).toBe('rocket');
  });

  it('rejects straights containing 2 or jokers', () => {
    expect(analyzePlay(cards(10, 11, 12, 13, 14))).toMatchObject({ type: 'straight' });
    expect(analyzePlay(cards(11, 12, 13, 14, 15))).toBeNull();
    expect(analyzePlay(cards(12, 13, 14, 15, 16))).toBeNull();
  });

  it('compares compatible plays and multipliers', () => {
    const pair7 = analyzePlay(cards(7, 7))!;
    const pair9 = analyzePlay(cards(9, 9))!;
    const triple9 = analyzePlay(cards(9, 9, 9))!;
    const bomb3 = analyzePlay(cards(3, 3, 3, 3))!;
    const rocket = analyzePlay(cards(16, 17))!;

    expect(canBeat(pair9, pair7)).toBe(true);
    expect(canBeat(pair7, pair9)).toBe(false);
    expect(canBeat(triple9, pair7)).toBe(false);
    expect(canBeat(bomb3, pair9)).toBe(true);
    expect(canBeat(rocket, bomb3)).toBe(true);
    expect(canBeat(bomb3, rocket)).toBe(false);
  });
});
