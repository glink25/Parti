export const ROLES = ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard', 'cupid'] as const;
export type Role = typeof ROLES[number];
export type Team = 'werewolves' | 'village' | 'lovers';
export type LoverRule = 'all-third-party' | 'mixed-third-party' | 'bond-only';
export type SelfSaveRule = 'never' | 'first-night' | 'always';
export type DeathCause = 'night-kill' | 'poison' | 'exile' | 'hunter-shot' | 'heartbreak' | 'disconnect';
export type PlayerCard = { role: Role };
export type RuleSettings = {
  loverRule: LoverRule;
  selfSave: SelfSaveRule;
  allowDoublePotion: boolean;
  allowConsecutiveGuard: boolean;
  guardSaveSurvives: boolean;
  poisonedHunterShoots: boolean;
};
export type DeathRecord = { playerId: string; cause: DeathCause; day: number };
export type GameResult = { winner: Team; reason: string } | null;

export const DEFAULT_RULES: RuleSettings = {
  loverRule: 'all-third-party',
  selfSave: 'first-night',
  allowDoublePotion: false,
  allowConsecutiveGuard: false,
  guardSaveSurvives: false,
  poisonedHunterShoots: false,
};

export const RECOMMENDED_DECKS: Record<number, Role[]> = {
  6: ['werewolf', 'werewolf', 'villager', 'villager', 'seer', 'witch'],
  7: ['werewolf', 'werewolf', 'villager', 'villager', 'seer', 'witch', 'hunter'],
  8: ['werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'seer', 'witch', 'hunter'],
  9: ['werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'seer', 'witch', 'hunter'],
  10: ['werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'seer', 'witch', 'hunter', 'guard', 'cupid'],
  11: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'seer', 'witch', 'hunter', 'guard', 'cupid'],
  12: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'seer', 'witch', 'hunter', 'guard', 'cupid'],
};

const UNIQUE_ROLES = new Set<Role>(['seer', 'witch', 'hunter', 'guard', 'cupid']);
const GOD_ROLES = new Set<Role>(['seer', 'witch', 'hunter', 'guard', 'cupid']);

export function validateDeck(roles: Role[], playerCount: number): string | null {
  if (playerCount < 6 || playerCount > 12) return '仅支持 6–12 名玩家';
  if (roles.length !== playerCount) return `当前有 ${roles.length} 张身份牌，需要 ${playerCount} 张`;
  if (!roles.every((role) => ROLES.includes(role))) return '包含未知身份牌';
  if (!roles.includes('werewolf')) return '至少需要一名狼人';
  if (!roles.includes('villager')) return '至少需要一名村民';
  if (!roles.some((role) => GOD_ROLES.has(role))) return '至少需要一名神职';
  for (const role of UNIQUE_ROLES) if (roles.filter((item) => item === role).length > 1) return `${role} 只能配置一张`;
  return null;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

export function dealRoles(playerIds: string[], roles: Role[], random: () => number): Record<string, PlayerCard> {
  if (validateDeck(roles, playerIds.length)) throw new Error('Invalid deck');
  const shuffled = shuffle(roles, random);
  return Object.fromEntries(playerIds.map((id, index) => [id, { role: shuffled[index] }]));
}

export function privateRolePayload(card: PlayerCard, round: number): { round: number; role: Role } {
  return { round, role: card.role };
}

export function tallyVotes(votes: Record<string, string>, weights: Record<string, number> = {}): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [voterId, targetId] of Object.entries(votes)) totals[targetId] = (totals[targetId] ?? 0) + (weights[voterId] ?? 1);
  return totals;
}

export function voteLeaders(totals: Record<string, number>): string[] {
  const entries = Object.entries(totals);
  if (!entries.length) return [];
  const highest = Math.max(...entries.map(([, total]) => total));
  return entries.filter(([, total]) => total === highest).map(([id]) => id);
}

export function isThirdPartyCouple(cards: Record<string, PlayerCard>, lovers: string[], rule: LoverRule): boolean {
  if (lovers.length !== 2 || rule === 'bond-only') return false;
  if (rule === 'all-third-party') return true;
  return cards[lovers[0]]?.role === 'werewolf' !== (cards[lovers[1]]?.role === 'werewolf');
}

export function resolveWinner(cards: Record<string, PlayerCard>, deadIds: string[], lovers: string[], rules: RuleSettings): GameResult {
  const dead = new Set(deadIds);
  const alive = Object.keys(cards).filter((id) => !dead.has(id));
  const thirdParty = isThirdPartyCouple(cards, lovers, rules.loverRule);
  if (thirdParty && lovers.every((id) => alive.includes(id)) && alive.every((id) => lovers.includes(id))) {
    return { winner: 'lovers', reason: '情侣共同存活并消灭了其他所有玩家' };
  }
  if (thirdParty && lovers.some((id) => alive.includes(id))) return null;
  const aliveWolves = alive.filter((id) => cards[id].role === 'werewolf');
  if (!aliveWolves.length) return { winner: 'village', reason: '所有狼人均已出局' };
  const aliveVillagers = alive.filter((id) => cards[id].role === 'villager');
  const aliveGods = alive.filter((id) => GOD_ROLES.has(cards[id].role));
  if (!aliveVillagers.length || !aliveGods.length) return { winner: 'werewolves', reason: !aliveVillagers.length ? '所有村民均已出局' : '所有神职均已出局' };
  return null;
}

export function resolveNightDeaths(input: {
  killedId: string | null;
  guardedId: string | null;
  saved: boolean;
  poisonedId: string | null;
  guardSaveSurvives: boolean;
}): Array<{ playerId: string; cause: DeathCause }> {
  const deaths: Array<{ playerId: string; cause: DeathCause }> = [];
  if (input.killedId) {
    const guarded = input.guardedId === input.killedId;
    const protectedBySave = input.saved;
    const survives = guarded && protectedBySave ? input.guardSaveSurvives : guarded || protectedBySave;
    if (!survives) deaths.push({ playerId: input.killedId, cause: 'night-kill' });
  }
  if (input.poisonedId && !deaths.some(({ playerId }) => playerId === input.poisonedId)) deaths.push({ playerId: input.poisonedId, cause: 'poison' });
  return deaths;
}

export function addDeathsWithHeartbreak(
  existing: DeathRecord[], additions: Array<{ playerId: string; cause: DeathCause }>, lovers: string[], day: number,
): DeathRecord[] {
  const next = [...existing];
  const dead = new Set(next.map(({ playerId }) => playerId));
  const queue = [...additions];
  while (queue.length) {
    const death = queue.shift()!;
    if (dead.has(death.playerId)) continue;
    dead.add(death.playerId);
    next.push({ ...death, day });
    if (lovers.includes(death.playerId)) {
      const partner = lovers.find((id) => id !== death.playerId);
      if (partner && !dead.has(partner)) queue.push({ playerId: partner, cause: 'heartbreak' });
    }
  }
  return next;
}

export function canWitchSelfSave(rule: SelfSaveRule, night: number): boolean {
  return rule === 'always' || (rule === 'first-night' && night === 1);
}

/**
 * 白天发言顺序：按座位（发牌）顺序返回存活玩家，从 startId 起环形排列。
 * startId 为空或已出局时，从第一个存活玩家开始。
 */
export function daySpeechOrder(dealtOrder: string[], deadIds: string[], startId: string | null): string[] {
  const dead = new Set(deadIds);
  const living = dealtOrder.filter((id) => !dead.has(id));
  if (living.length === 0) return [];
  const startIndex = startId ? living.indexOf(startId) : -1;
  const offset = startIndex >= 0 ? startIndex : 0;
  return [...living.slice(offset), ...living.slice(0, offset)];
}
