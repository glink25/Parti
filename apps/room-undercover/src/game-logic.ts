import { CATEGORIES, type Category } from './categories';
import type { WordPair } from './word-bank';

export type Role = 'civilian' | 'undercover' | 'blank';
export type Winner = Role;
export type Card = { role: Role; word: string };
export type RevealedWords = { civilian: string; undercover: string };
export type DealMode = 'classic' | 'custom';
export type DealResult = {
  cards: Record<string, Card>;
  words: RevealedWords;
  hadBlank: boolean;
  hadUndercover: boolean;
};
export type EliminationResult = {
  finished: boolean;
  winner: Winner | null;
  revealedWords: RevealedWords | null;
  hadBlank: boolean;
  hadUndercover: boolean;
};

export function undercoverCount(playerCount: number): number {
  if (playerCount < 3) return 0;
  if (playerCount <= 5) return 1;
  if (playerCount <= 9) return 2;
  return 3;
}

export function blankAppearanceChance(playerCount: number): number {
  if (playerCount < 3) return 0;
  if (playerCount === 3) return 0.25;
  if (playerCount === 4) return 0.5;
  if (playerCount === 5) return 0.75;
  return 1;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && CATEGORIES.includes(value as Category);
}

export function normalizeCategories(value: unknown): Category[] | null {
  if (!Array.isArray(value)) return null;
  const categories = [...new Set(value)];
  if (categories.length === 0 || !categories.every(isCategory)) return null;
  return categories;
}

export function eligiblePairs(wordPairs: WordPair[], categories: Category[]): WordPair[] {
  const selected = new Set(categories);
  return wordPairs.filter((pair) => selected.has(pair.category));
}

export function choosePair(
  candidates: WordPair[],
  usedIds: Set<string>,
  random: () => number,
): { pair: WordPair; reset: boolean } {
  if (candidates.length === 0) throw new Error('No eligible word pairs');
  let available = candidates.filter((pair) => !usedIds.has(pair.id));
  const reset = available.length === 0;
  if (reset) available = candidates;
  const index = Math.min(available.length - 1, Math.floor(random() * available.length));
  return { pair: available[index], reset };
}

export function dealCards(
  playerIds: string[],
  pair: WordPair,
  random: () => number,
  includeBlank = false,
): DealResult {
  const swapWords = random() < 0.5;
  return dealCardsWithWords(
    playerIds,
    swapWords
      ? { civilian: pair.undercover, undercover: pair.civilian }
      : { civilian: pair.civilian, undercover: pair.undercover },
    random,
    includeBlank,
  );
}

export function dealCardsWithWords(
  playerIds: string[],
  words: RevealedWords,
  random: () => number,
  includeBlank = false,
): DealResult {
  const hasBlank = includeBlank && random() < blankAppearanceChance(playerIds.length);
  const shuffled = [...playerIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }

  const blankId = hasBlank ? shuffled[0] : null;
  const undercovers = hasBlank
    ? (playerIds.length === 3 ? 0 : Math.max(1, undercoverCount(playerIds.length) - (playerIds.length >= 6 ? 1 : 0)))
    : undercoverCount(playerIds.length);
  const undercoverIds = new Set(shuffled.slice(hasBlank ? 1 : 0, (hasBlank ? 1 : 0) + undercovers));
  const cards = Object.fromEntries(playerIds.map((id) => {
    const role: Role = id === blankId ? 'blank' : undercoverIds.has(id) ? 'undercover' : 'civilian';
    const word = role === 'blank' ? '' : role === 'undercover' ? words.undercover : words.civilian;
    return [id, { role, word }];
  }));

  return { cards, words, hadBlank: hasBlank, hadUndercover: undercovers > 0 };
}

export function participantIds(
  players: Array<{ id: string; role: 'host' | 'player' | 'spectator' }>,
  mode: DealMode,
): string[] {
  return players
    .filter((player) => player.role !== 'spectator' && (mode === 'classic' || player.role !== 'host'))
    .map((player) => player.id);
}

export function normalizeCustomWords(value: unknown): RevealedWords | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as { civilianWord?: unknown; undercoverWord?: unknown };
  if (typeof payload.civilianWord !== 'string' || typeof payload.undercoverWord !== 'string') return null;
  const civilian = payload.civilianWord.trim();
  const undercover = payload.undercoverWord.trim();
  if (!civilian || !undercover || civilian === undercover) return null;
  if (civilian.length > 20 || undercover.length > 20) return null;
  return { civilian, undercover };
}

export function privateCardPayload(card: Card, round: number): { round: number; word: string } {
  return { round, word: card.word };
}

export function resolveElimination(
  deal: DealResult,
  eliminatedPlayerIds: string[],
): EliminationResult {
  const eliminated = new Set(eliminatedPlayerIds);
  const alive = Object.entries(deal.cards)
    .filter(([playerId]) => !eliminated.has(playerId))
    .map(([, card]) => card);
  const aliveUndercover = alive.filter(({ role }) => role === 'undercover').length;
  const aliveCivilian = alive.filter(({ role }) => role === 'civilian').length;
  const aliveBlank = alive.some(({ role }) => role === 'blank');

  let winner: Winner | null = null;
  if (aliveUndercover === 0) winner = aliveBlank ? 'blank' : 'civilian';
  else if (aliveCivilian <= aliveUndercover) winner = 'undercover';

  return {
    finished: winner !== null,
    winner,
    revealedWords: winner ? deal.words : null,
    hadBlank: deal.hadBlank,
    hadUndercover: deal.hadUndercover,
  };
}
