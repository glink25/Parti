import type { Card, PlayAnalysis } from './types';

type RankGroup = {
  rank: number;
  count: number;
};

const PLAY_LABELS: Record<string, string> = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  'triple-single': '三带一',
  'triple-pair': '三带二',
  straight: '顺子',
  'pair-straight': '连对',
  airplane: '飞机',
  'airplane-singles': '飞机带单',
  'airplane-pairs': '飞机带对',
  'four-two-singles': '四带二',
  'four-two-pairs': '四带两对',
  bomb: '炸弹',
  rocket: '火箭',
};

export function analyzePlay(cards: Card[]): PlayAnalysis | null {
  if (cards.length === 0) return null;
  const groups = rankGroups(cards);
  const counts = groups.map((g) => g.count).sort((a, b) => b - a);
  const ranks = groups.map((g) => g.rank).sort((a, b) => a - b);
  const length = cards.length;

  if (length === 2 && ranks.includes(16) && ranks.includes(17)) {
    return analysis('rocket', 17, length);
  }
  if (length === 4 && groups.length === 1) {
    return analysis('bomb', groups[0].rank, length);
  }
  if (length === 1) return analysis('single', ranks[0], length);
  if (length === 2 && groups.length === 1) return analysis('pair', ranks[0], length);
  if (length === 3 && groups.length === 1) return analysis('triple', ranks[0], length);
  if (length === 4 && counts[0] === 3) return analysis('triple-single', rankOfCount(groups, 3), length);
  if (length === 5 && counts[0] === 3 && counts[1] === 2) {
    return analysis('triple-pair', rankOfCount(groups, 3), length);
  }

  if (length >= 5 && groups.every((g) => g.count === 1) && isConsecutive(ranks)) {
    return analysis('straight', ranks.at(-1)!, length, ranks.length);
  }
  if (length >= 6 && length % 2 === 0 && groups.every((g) => g.count === 2) && isConsecutive(ranks)) {
    return analysis('pair-straight', ranks.at(-1)!, length, ranks.length);
  }

  const triples = groups.filter((g) => g.count === 3).map((g) => g.rank).sort((a, b) => a - b);
  if (triples.length >= 2) {
    const chains = consecutiveSlices(triples);
    for (const chain of chains) {
      const n = chain.length;
      const mainRank = chain.at(-1)!;
      if (length === n * 3) return analysis('airplane', mainRank, length, n);
      if (length === n * 4 && countNonChainCards(groups, chain) === n) {
        return analysis('airplane-singles', mainRank, length, n);
      }
      if (length === n * 5 && countPairAttachments(groups, chain) === n) {
        return analysis('airplane-pairs', mainRank, length, n);
      }
    }
  }

  if (length === 6 && counts[0] === 4) return analysis('four-two-singles', rankOfCount(groups, 4), length);
  if (length === 8 && counts[0] === 4 && groups.filter((g) => g.count === 2).length === 2) {
    return analysis('four-two-pairs', rankOfCount(groups, 4), length);
  }

  return null;
}

export function canBeat(candidate: PlayAnalysis, previous: PlayAnalysis | null): boolean {
  if (!previous) return true;
  if (candidate.type === 'rocket') return previous.type !== 'rocket';
  if (previous.type === 'rocket') return false;
  if (candidate.type === 'bomb' && previous.type !== 'bomb') return true;
  if (previous.type === 'bomb' && candidate.type !== 'bomb') return false;
  if (candidate.type !== previous.type) return false;
  if (candidate.length !== previous.length) return false;
  if ((candidate.chainLength ?? 0) !== (previous.chainLength ?? 0)) return false;
  return candidate.rank > previous.rank;
}

export function isMultiplierPlay(play: PlayAnalysis): boolean {
  return play.type === 'bomb' || play.type === 'rocket';
}

function analysis(type: PlayAnalysis['type'], rank: number, length: number, chainLength?: number): PlayAnalysis {
  return {
    type,
    rank,
    length,
    chainLength,
    label: PLAY_LABELS[type],
  };
}

function rankGroups(cards: Card[]): RankGroup[] {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
}

function rankOfCount(groups: RankGroup[], count: number): number {
  return groups.find((g) => g.count === count)!.rank;
}

function isConsecutive(ranks: number[]): boolean {
  if (ranks.some((rank) => rank >= 15)) return false;
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

function consecutiveSlices(ranks: number[]): number[][] {
  const valid = ranks.filter((rank) => rank < 15).sort((a, b) => a - b);
  const slices: number[][] = [];
  let start = 0;
  for (let i = 1; i <= valid.length; i += 1) {
    if (i === valid.length || valid[i] !== valid[i - 1] + 1) {
      const run = valid.slice(start, i);
      for (let len = run.length; len >= 2; len -= 1) {
        for (let offset = 0; offset + len <= run.length; offset += 1) {
          slices.push(run.slice(offset, offset + len));
        }
      }
      start = i;
    }
  }
  return slices.sort((a, b) => b.length - a.length || b.at(-1)! - a.at(-1)!);
}

function countNonChainCards(groups: RankGroup[], chain: number[]): number {
  const chainRanks = new Set(chain);
  return groups.reduce((sum, group) => sum + (chainRanks.has(group.rank) ? Math.max(0, group.count - 3) : group.count), 0);
}

function countPairAttachments(groups: RankGroup[], chain: number[]): number {
  const chainRanks = new Set(chain);
  return groups.filter((group) => !chainRanks.has(group.rank) && group.count === 2).length;
}
