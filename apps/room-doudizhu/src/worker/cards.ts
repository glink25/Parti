import type { Card, Suit } from './types';

const SUITS: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const RANK_LABELS: Record<number, string> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
  16: '小王',
  17: '大王',
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 3; rank <= 15; rank += 1) {
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        label: RANK_LABELS[rank],
      });
    }
  }
  deck.push({ id: 'joker-16', suit: 'joker', rank: 16, label: RANK_LABELS[16] });
  deck.push({ id: 'joker-17', suit: 'joker', rank: 17, label: RANK_LABELS[17] });
  return deck;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

export function removeCards(hand: Card[], ids: string[]): Card[] | null {
  const remaining = [...hand];
  const selected: Card[] = [];
  for (const id of ids) {
    const index = remaining.findIndex((card) => card.id === id);
    if (index < 0) return null;
    selected.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return selected;
}
