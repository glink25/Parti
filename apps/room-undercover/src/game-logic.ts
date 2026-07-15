import { CATEGORIES, type Category, type WordPair } from './words';

export type Role = 'civilian' | 'undercover';
export type Card = { role: Role; word: string };
export type RevealedWords = { civilian: string; undercover: string };
export type DealMode = 'classic' | 'blank' | 'custom';

export function undercoverCount(playerCount: number): number {
  if (playerCount < 3) return 0;
  if (playerCount <= 5) return 1;
  if (playerCount <= 9) return 2;
  return 3;
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
): Record<string, Card> {
  const swapWords = random() < 0.5;
  return dealCardsWithWords(
    playerIds,
    swapWords
      ? { civilian: pair.undercover, undercover: pair.civilian }
      : { civilian: pair.civilian, undercover: pair.undercover },
    random,
  );
}

export function dealCardsWithWords(
  playerIds: string[],
  words: RevealedWords,
  random: () => number,
): Record<string, Card> {
  const shuffled = [...playerIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }

  const undercoverIds = new Set(shuffled.slice(0, undercoverCount(playerIds.length)));

  return Object.fromEntries(playerIds.map((id) => {
    const role: Role = undercoverIds.has(id) ? 'undercover' : 'civilian';
    return [id, { role, word: role === 'undercover' ? words.undercover : words.civilian }];
  }));
}

export function participantIds(
  players: Array<{ id: string; role: 'host' | 'player' | 'spectator' }>,
  mode: DealMode,
): string[] {
  return players
    .filter((player) => player.role !== 'spectator' && (mode === 'classic' || player.role !== 'host'))
    .map((player) => player.id);
}

export function normalizeCustomWords(
  value: unknown,
): RevealedWords | null {
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
  cards: Record<string, Card>,
  eliminatedPlayerIds: string[],
): { finished: boolean; revealedWords: RevealedWords | null } {
  const eliminated = new Set(eliminatedPlayerIds);
  const finished = Object.entries(cards).every(
    ([playerId, card]) => card.role !== 'undercover' || eliminated.has(playerId),
  );
  if (!finished) return { finished: false, revealedWords: null };

  const civilianCard = Object.values(cards).find((card) => card.role === 'civilian');
  const undercoverCard = Object.values(cards).find((card) => card.role === 'undercover');
  if (!civilianCard || !undercoverCard) return { finished: false, revealedWords: null };
  return {
    finished: true,
    revealedWords: { civilian: civilianCard.word, undercover: undercoverCard.word },
  };
}
