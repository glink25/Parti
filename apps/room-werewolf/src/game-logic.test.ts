import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES, RECOMMENDED_DECKS, addDeathsWithHeartbreak, canWitchSelfSave, dealRoles,
  privateRolePayload, resolveNightDeaths, resolveWinner, tallyVotes, validateDeck, voteLeaders,
  type PlayerCard,
} from './game-logic';

describe('recommended decks', () => {
  it.each(Object.entries(RECOMMENDED_DECKS))('provides a legal %s player deck', (count, roles) => {
    expect(validateDeck(roles, Number(count))).toBeNull();
    expect(roles).toHaveLength(Number(count));
  });

  it('rejects mismatched, missing-side, and duplicate unique roles', () => {
    expect(validateDeck(['werewolf', 'villager', 'seer'], 6)).toContain('需要');
    expect(validateDeck(['villager', 'villager', 'seer', 'witch', 'hunter', 'guard'], 6)).toContain('狼人');
    expect(validateDeck(['werewolf', 'villager', 'seer', 'seer', 'villager', 'villager'], 6)).toContain('只能配置一张');
  });
});

describe('dealing and secrecy', () => {
  it('deals every configured role exactly once', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const cards = dealRoles(ids, RECOMMENDED_DECKS[6], () => 0.99);
    expect(Object.keys(cards)).toEqual(ids);
    expect(Object.values(cards).map(({ role }) => role).sort()).toEqual([...RECOMMENDED_DECKS[6]].sort());
  });

  it('private role payload contains no pack, lover, or action data', () => {
    const payload = privateRolePayload({ role: 'werewolf' }, 3);
    expect(payload).toEqual({ round: 3, role: 'werewolf' });
    expect(payload).not.toHaveProperty('playerIds');
  });
});

describe('votes', () => {
  it('applies sheriff weight and returns all tied leaders', () => {
    expect(tallyVotes({ sheriff: 'a', b: 'b', c: 'b' }, { sheriff: 1.5 })).toEqual({ a: 1.5, b: 2 });
    expect(voteLeaders({ a: 2, b: 2, c: 1 })).toEqual(['a', 'b']);
  });
});

describe('night resolution', () => {
  it('supports guard, save, poison, and configurable guard-save collision', () => {
    expect(resolveNightDeaths({ killedId: 'a', guardedId: 'a', saved: false, poisonedId: 'b', guardSaveSurvives: false })).toEqual([{ playerId: 'b', cause: 'poison' }]);
    expect(resolveNightDeaths({ killedId: 'a', guardedId: 'a', saved: true, poisonedId: null, guardSaveSurvives: false })).toEqual([{ playerId: 'a', cause: 'night-kill' }]);
    expect(resolveNightDeaths({ killedId: 'a', guardedId: 'a', saved: true, poisonedId: null, guardSaveSurvives: true })).toEqual([]);
  });

  it('applies self-save settings', () => {
    expect(canWitchSelfSave('never', 1)).toBe(false);
    expect(canWitchSelfSave('first-night', 1)).toBe(true);
    expect(canWitchSelfSave('first-night', 2)).toBe(false);
    expect(canWitchSelfSave('always', 3)).toBe(true);
  });
});

describe('death chains and victory', () => {
  const cards: Record<string, PlayerCard> = {
    wolf: { role: 'werewolf' }, villager: { role: 'villager' }, seer: { role: 'seer' }, cupid: { role: 'cupid' },
  };

  it('chains a lover death once', () => {
    expect(addDeathsWithHeartbreak([], [{ playerId: 'wolf', cause: 'exile' }], ['wolf', 'seer'], 2)).toEqual([
      { playerId: 'wolf', cause: 'exile', day: 2 }, { playerId: 'seer', cause: 'heartbreak', day: 2 },
    ]);
  });

  it('resolves village, werewolf, and all-couple third-party wins', () => {
    expect(resolveWinner(cards, ['wolf'], [], DEFAULT_RULES)?.winner).toBe('village');
    expect(resolveWinner(cards, ['villager'], [], DEFAULT_RULES)?.winner).toBe('werewolves');
    expect(resolveWinner(cards, ['villager', 'cupid'], ['wolf', 'seer'], DEFAULT_RULES)?.winner).toBe('lovers');
  });

  it('does not make same-team lovers third-party under mixed-only rules', () => {
    const twoWolves = { ...cards, wolf2: { role: 'werewolf' as const } };
    const rules = { ...DEFAULT_RULES, loverRule: 'mixed-third-party' as const };
    expect(resolveWinner(twoWolves, ['villager', 'seer', 'cupid'], ['wolf', 'wolf2'], rules)?.winner).toBe('werewolves');
  });

  it('does not let an original faction win while third-party lovers survive', () => {
    expect(resolveWinner(cards, ['wolf'], ['villager', 'seer'], DEFAULT_RULES)).toBeNull();
  });
});
