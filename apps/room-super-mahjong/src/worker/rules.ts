import type { Meld, ReactionClaim, Tile, TileKind, WinAnalysis, WinFeatures } from './types';

const SUITS = ['m', 'p', 's'] as const;
const KINDS: TileKind[] = SUITS.flatMap((suit) => Array.from({ length: 9 }, (_, index) => `${suit}${index + 1}` as TileKind));

export function createDeck(): Tile[] {
  const deck: Tile[] = [];
  for (const kind of [...KINDS, 'z' as const]) {
    for (let copy = 0; copy < 4; copy += 1) deck.push({ id: `${kind}-${copy}`, kind });
  }
  return deck;
}

export function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => kindIndex(a.kind) - kindIndex(b.kind) || a.id.localeCompare(b.id));
}

export function analyzeWin(tiles: Tile[], melds: Meld[]): WinAnalysis {
  const wild = tiles.filter((tile) => tile.kind === 'z').length;
  const counts = KINDS.map((kind) => tiles.filter((tile) => tile.kind === kind).length);
  const groupsNeeded = 4 - melds.length;
  const tileCountValid = tiles.length === groupsNeeded * 3 + 2;
  const sevenPairs = melds.length === 0 && tiles.length === 14 && canSevenPairs(counts, wild);
  const standardResult = tileCountValid ? canStandard(counts, wild, groupsNeeded) : null;
  const standard = Boolean(standardResult);
  const visibleKinds = [...tiles, ...melds.flatMap((meld) => meld.tiles)]
    .filter((tile) => tile.kind !== 'z').map((tile) => tile.kind[0]);
  const pureSuit = visibleKinds.length > 0 && new Set(visibleKinds).size === 1;
  const meldsAllPungs = melds.every((meld) => meld.kind !== 'chi');
  return {
    winning: standard || sevenPairs,
    standard,
    sevenPairs,
    allPungs: Boolean(standardResult?.allPungs && meldsAllPungs),
    pureSuit,
  };
}

function canSevenPairs(counts: number[], wild: number): boolean {
  const odd = counts.filter((count) => count % 2 === 1).length;
  return odd <= wild && (wild - odd) % 2 === 0;
}

function canStandard(counts: number[], wild: number, groupsNeeded: number): { allPungs: boolean } | null {
  for (let pairIndex = -1; pairIndex < counts.length; pairIndex += 1) {
    const next = [...counts];
    const natural = pairIndex < 0 ? 0 : Math.min(2, next[pairIndex]!);
    const needed = 2 - natural;
    if (needed > wild) continue;
    if (pairIndex >= 0) next[pairIndex] -= natural;
    const groupResult = consumeGroups(next, wild - needed, groupsNeeded);
    if (groupResult) return groupResult;
  }
  return null;
}

function consumeGroups(counts: number[], wild: number, groupsLeft: number): { allPungs: boolean } | null {
  const remaining = counts.reduce((sum, count) => sum + count, 0) + wild;
  if (groupsLeft === 0) return remaining === 0 ? { allPungs: true } : null;
  if (remaining !== groupsLeft * 3) return null;
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return wild === groupsLeft * 3 ? { allPungs: true } : null;

  const pungCounts = [...counts];
  const naturalPung = Math.min(3, pungCounts[first]!);
  const pungWild = 3 - naturalPung;
  if (pungWild <= wild) {
    pungCounts[first] -= naturalPung;
    const result = consumeGroups(pungCounts, wild - pungWild, groupsLeft - 1);
    if (result) return { allPungs: result.allPungs };
  }

  const rank = first % 9;
  if (rank <= 6) {
    const sequenceCounts = [...counts];
    let sequenceWild = 0;
    for (const index of [first, first + 1, first + 2]) {
      if (sequenceCounts[index]! > 0) sequenceCounts[index] -= 1;
      else sequenceWild += 1;
    }
    if (sequenceWild <= wild) {
      const result = consumeGroups(sequenceCounts, wild - sequenceWild, groupsLeft - 1);
      if (result) return { allPungs: false };
    }
  }
  return null;
}

export function scoreWin(config: { baseScore: number; maxFan: number }, features: WinFeatures) {
  const patterns: Array<{ name: string; fan: number }> = [];
  if (features.standard && !features.allPungs && !features.pureSuit) patterns.push({ name: '平胡', fan: 1 });
  if (features.selfDraw) patterns.push({ name: '自摸', fan: 1 });
  if (features.allPungs) patterns.push({ name: '碰碰胡', fan: 2 });
  if (features.pureSuit) patterns.push({ name: '清一色', fan: 3 });
  if (features.sevenPairs) patterns.push({ name: '七对', fan: 2 });
  if (features.gangBloom) patterns.push({ name: '杠上花', fan: 1 });
  const rawFan = patterns.reduce((sum, pattern) => sum + pattern.fan, 0);
  const fan = Math.min(config.maxFan, rawFan);
  const eventMultiplier = (features.robGang ? 2 : 1) * (features.lastTile ? 2 : 1);
  return { fan, rawFan, patterns, eventMultiplier, points: config.baseScore * 2 ** fan * eventMultiplier };
}

export function scoreGang(kind: 'concealed' | 'added' | 'discard', baseScore: number) {
  if (kind === 'concealed') return { winner: baseScore * 6, payments: [baseScore * 2, baseScore * 2, baseScore * 2] };
  if (kind === 'discard') return { winner: baseScore * 6, payments: [baseScore * 6] };
  return { winner: baseScore * 3, payments: [baseScore, baseScore, baseScore] };
}

export function rankReactions(claims: ReactionClaim[], discarderSeat: number, multiWin: boolean): ReactionClaim[] {
  const priority = { win: 3, gang: 2, peng: 2, chi: 1 } as const;
  const sorted = [...claims].sort((a, b) => priority[b.kind] - priority[a.kind]
    || seatDistance(a.seat, discarderSeat) - seatDistance(b.seat, discarderSeat));
  if (sorted[0]?.kind === 'win' && multiWin) return sorted.filter((claim) => claim.kind === 'win');
  return sorted.slice(0, 1);
}

export function seatDistance(seat: number, fromSeat: number) {
  return (seat - fromSeat + 4) % 4;
}

export function tileSuit(kind: TileKind) { return kind === 'z' ? null : kind[0] as 'm'|'p'|'s'; }
export function tileRank(kind: TileKind) { return kind === 'z' ? 0 : Number(kind[1]); }
export function kindIndex(kind: TileKind) { return kind === 'z' ? 27 : KINDS.indexOf(kind); }
