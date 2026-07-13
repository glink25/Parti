import { describe, expect, it } from 'vitest';
import {
  analyzeWin,
  createDeck,
  rankReactions,
  scoreGang,
  scoreWin,
} from './rules';
import type { Meld, ReactionClaim, Tile, TileKind } from './types';

function hand(...kinds: TileKind[]): Tile[] {
  return kinds.map((kind, index) => ({ id: `${kind}:${index}`, kind }));
}

const noMelds: Meld[] = [];

describe('super mahjong rules', () => {
  it('creates the 112 tile red-center deck', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(112);
    expect(deck.filter((tile) => tile.kind === 'z').length).toBe(4);
    expect(new Set(deck.map((tile) => tile.id)).size).toBe(112);
  });

  it('recognizes a standard win and wildcard substitution', () => {
    const result = analyzeWin(hand('m1','m2','m3','m4','m5','z','p2','p3','p4','s7','s7','s7','m9','m9'), noMelds);
    expect(result).toMatchObject({ winning: true, sevenPairs: false });
  });

  it('recognizes seven pairs and rejects an invalid hand', () => {
    expect(analyzeWin(hand('m1','m1','m2','m2','p3','p3','p4','p4','s5','s5','s6','s6','z','z'), noMelds)).toMatchObject({ winning: true, sevenPairs: true });
    expect(analyzeWin(hand('m1','m1','m2','m3','p3','p4','p5','p7','s1','s3','s5','s7','s9','z'), noMelds).winning).toBe(false);
  });

  it('scores core patterns with cap and event multipliers', () => {
    const result = scoreWin({ baseScore: 2, maxFan: 4 }, {
      standard: true, sevenPairs: false, allPungs: true, pureSuit: true,
      selfDraw: true, gangBloom: false, robGang: true, lastTile: false,
    });
    expect(result).toMatchObject({ fan: 4, points: 64, eventMultiplier: 2 });
  });

  it('scores concealed, added and discard gangs', () => {
    expect(scoreGang('concealed', 1)).toEqual({ winner: 6, payments: [2, 2, 2] });
    expect(scoreGang('added', 1)).toEqual({ winner: 3, payments: [1, 1, 1] });
    expect(scoreGang('discard', 1)).toEqual({ winner: 6, payments: [6] });
  });

  it('prioritizes win over peng/gang over chi and supports nearest interception', () => {
    const claims: ReactionClaim[] = [
      { playerId: 'p1', seat: 1, kind: 'chi' },
      { playerId: 'p2', seat: 2, kind: 'peng' },
      { playerId: 'p3', seat: 3, kind: 'win' },
    ];
    expect(rankReactions(claims, 0, true).map((claim) => claim.playerId)).toEqual(['p3']);
    expect(rankReactions([
      { playerId: 'p2', seat: 2, kind: 'win' },
      { playerId: 'p1', seat: 1, kind: 'win' },
    ], 0, false).map((claim) => claim.playerId)).toEqual(['p1']);
  });
});
