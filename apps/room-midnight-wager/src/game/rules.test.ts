import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch } from './rules';
import type { Card, GameSession } from './types';

const players = ['host', 'alice', 'bob', 'cara'].map((id, seat) => ({
  id,
  name: id,
  role: seat === 0 ? ('host' as const) : ('player' as const),
}));

function rigHand(session: GameSession, playerId: string, cards: Card[]) {
  session.secret.hands[playerId] = cards;
  session.state.players[playerId].handCount = cards.length;
}

describe('midnight wager rules', () => {
  it.each([
    [2, 5, 10],
    [3, 5, 15],
    [4, 5, 20],
  ])('deals a private classic hand to %i players', (count, handSize, dealtCards) => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, count), ruleset: 'classic' },
      () => 0.25,
    );

    expect(session.state.phase).toBe('playing');
    expect(Object.values(session.state.players).map((player) => player.handCount)).toEqual(
      Array(count).fill(handSize),
    );
    expect(Object.values(session.secret.hands).flat()).toHaveLength(dealtCards);
    expect(session.secret.deck).toHaveLength(20 - dealtCards);
    expect(JSON.stringify(session.state)).not.toContain('fatalPull');
    expect(JSON.stringify(session.state)).not.toContain('shotTargets');
    expect(JSON.stringify(session.state)).not.toContain('deck');
    expect(JSON.stringify(session.state)).not.toContain('cards');
  });

  it.each([
    [2, 6],
    [3, 3],
    [4, 0],
  ])('keeps %i-player chaos undealt cards in Worker-only state', (count, remaining) => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, count), ruleset: 'chaos' },
      () => 0.25,
    );

    expect(session.secret.deck).toHaveLength(remaining);
    expect(Object.values(session.secret.hands).flat()).toHaveLength(count * 3);
  });

  it('plays owned cards face down and only exposes their count', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'classic' },
      () => 0.25,
    );
    const actorId = session.state.currentPlayerId!;
    const cardIds = session.secret.hands[actorId].slice(0, 2).map((card) => card.id);

    const transition = applyCommand(session, { type: 'playCards', actorId, cardIds }, () => 0.25);

    expect(transition.error).toBeUndefined();
    expect(transition.session.state.lastPlay).toEqual({ playerId: actorId, count: 2 });
    expect(transition.session.state.players[actorId].handCount).toBe(3);
    expect(transition.session.secret.pile.at(-1)?.cards.map((card) => card.id)).toEqual(cardIds);
    expect(transition.sends).toContainEqual({
      playerId: actorId,
      event: 'private:hand',
      payload: { hand: transition.session.secret.hands[actorId] },
    });
    const committed = transition.broadcasts.find((effect) => effect.event === 'game:action' && effect.payload.kind === 'cardsCommitted');
    expect(committed).toMatchObject({ event: 'game:action', payload: { kind: 'cardsCommitted', actorId, count: 2 } });
    expect(JSON.stringify(committed)).not.toContain(cardIds[0]);
    expect(committed?.event === 'game:action' ? committed.payload.cards : undefined).toBeUndefined();
  });

  it('rejects forged cards and out-of-turn play without changing the session', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'classic' },
      () => 0.25,
    );
    const actorId = session.state.currentPlayerId!;
    const otherId = Object.keys(session.state.players).find((id) => id !== actorId)!;

    const forged = applyCommand(session, { type: 'playCards', actorId, cardIds: ['forged'] }, () => 0.25);
    const outOfTurn = applyCommand(
      session,
      { type: 'playCards', actorId: otherId, cardIds: [session.secret.hands[otherId][0].id] },
      () => 0.25,
    );

    expect(forged.error).toBe('你没有这些牌');
    expect(outOfTurn.error).toBe('还没轮到你');
    expect(forged.session).toEqual(session);
    expect(outOfTurn.session).toEqual(session);
  });

  it('forces the final card holder to challenge instead of emptying the table', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'classic' },
      () => 0.25,
    );
    session.state.currentPlayerId = 'alice';
    rigHand(session, 'host', []);
    rigHand(session, 'alice', [{ id: 'last-card', kind: 'A' }]);
    rigHand(session, 'bob', []);
    session.secret.pile = [{ playerId: 'host', cards: [{ id: 'previous', kind: 'Q' }] }];
    session.state.lastPlay = { playerId: 'host', count: 1 };
    session.state.pileCount = 1;

    const played = applyCommand(
      session,
      { type: 'playCards', actorId: 'alice', cardIds: ['last-card'] },
      () => 0.25,
    );
    expect(played.error).toBe('只剩你持牌，必须质疑上一手');
  });

  it('punishes an incorrect classic challenge and advances the loser revolver', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 2), ruleset: 'classic' },
      () => 0.25,
    );
    session.state.tableRank = 'A';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [{ id: 'truth', kind: 'A' }]);
    rigHand(session, 'alice', [{ id: 'waiting', kind: 'Q' }]);
    session.secret.fatalPulls.alice = 2;

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['truth'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);
    const pulled = applyCommand(challenged.session, { type: 'pullTrigger', actorId: 'alice' }, () => 0.25);

    expect(challenged.session.state.roulette?.fixedTargets).toEqual({ alice: 'alice' });
    expect(pulled.session.state.phase).toBe('resolution');
    expect(pulled.session.state.players.alice.safePulls).toBe(1);
    expect(pulled.session.state.resolution?.shots).toEqual([
      { shooterId: 'alice', targetId: 'alice', lethal: false },
    ]);

    const advanced = applyCommand(
      pulled.session,
      { type: 'advanceResolution', actorId: 'host' },
      () => 0.25,
    );
    expect(advanced.session.state.phase).toBe('playing');
    expect(advanced.session.state.round).toBe(2);
    expect(advanced.session.state.currentPlayerId).toBe('alice');
  });

  it('eliminates a caught liar when their fatal chamber fires', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 2), ruleset: 'classic' },
      () => 0.25,
    );
    session.state.tableRank = 'A';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [{ id: 'lie', kind: 'Q' }]);
    rigHand(session, 'alice', [{ id: 'truth', kind: 'A' }]);
    session.secret.fatalPulls.host = 1;

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['lie'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);
    const pulled = applyCommand(challenged.session, { type: 'pullTrigger', actorId: 'host' }, () => 0.25);

    expect(challenged.session.state.roulette?.fixedTargets).toEqual({ host: 'host' });
    expect(pulled.session.state.phase).toBe('finished');
    expect(pulled.session.state.players.host.alive).toBe(false);
    expect(pulled.session.state.winnerId).toBe('alice');
    expect(pulled.session.state.players.alice.wins).toBe(1);
  });

  it('starts the next round with the next survivor when the loser is eliminated', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'classic' },
      () => 0.25,
    );
    session.state.tableRank = 'A';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [{ id: 'lie', kind: 'Q' }]);
    rigHand(session, 'alice', [{ id: 'alice-card', kind: 'A' }]);
    rigHand(session, 'bob', [{ id: 'bob-card', kind: 'A' }]);
    session.secret.fatalPulls.host = 1;

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['lie'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);
    const shot = applyCommand(challenged.session, { type: 'pullTrigger', actorId: 'host' }, () => 0.25);
    const advanced = applyCommand(
      shot.session,
      { type: 'advanceResolution', actorId: 'host' },
      () => 0.99,
    );

    expect(advanced.session.state.currentPlayerId).toBe('alice');
  });

  it('requires an active devil card to be played alone and punishes the other card holders', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'devil' },
      () => 0.25,
    );
    session.state.tableRank = 'A';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [
      { id: 'devil', kind: 'A', devilMarked: true },
      { id: 'other', kind: 'Q' },
    ]);
    rigHand(session, 'alice', [{ id: 'alice-card', kind: 'K' }]);
    rigHand(session, 'bob', [{ id: 'bob-card', kind: 'K' }]);

    const mixed = applyCommand(
      session,
      { type: 'playCards', actorId: 'host', cardIds: ['devil', 'other'] },
      () => 0.25,
    );
    expect(mixed.error).toBe('恶魔牌必须单独打出');

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['devil'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);

    expect(challenged.session.state.reveal?.reason).toBe('devil');
    expect(challenged.session.state.roulette?.shooterIds).toEqual(['alice', 'bob']);
    expect(challenged.session.state.roulette?.fixedTargets).toEqual({ alice: 'alice', bob: 'bob' });
  });

  it('treats a marked table card as ordinary when only two players remain', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 2), ruleset: 'devil' },
      () => 0.25,
    );
    session.state.tableRank = 'A';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [
      { id: 'marked', kind: 'A', devilMarked: true },
      { id: 'plain', kind: 'A' },
    ]);

    const played = applyCommand(
      session,
      { type: 'playCards', actorId: 'host', cardIds: ['marked', 'plain'] },
      () => 0.25,
    );
    expect(played.error).toBeUndefined();
  });

  it('resolves both outcomes of the current devil deal rule', () => {
    const base = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'devil' },
      () => 0.25,
    );
    base.state.tableRank = 'A';
    base.state.currentPlayerId = 'alice';
    base.secret.pile = [
      { playerId: 'host', cards: [{ id: 'l1', kind: 'Q' }] },
      { playerId: 'alice', cards: [{ id: 'l2', kind: 'K' }] },
      { playerId: 'bob', cards: [{ id: 'l3', kind: 'Q' }] },
      { playerId: 'host', cards: [{ id: 'l4', kind: 'K' }] },
    ];
    base.state.pileCount = 4;

    const allLies = applyCommand(base, { type: 'callDevilsDeal', actorId: 'alice' }, () => 0.25);
    expect(allLies.session.state.roulette?.shooterIds).toEqual(['host', 'bob']);
    expect(allLies.session.state.reveal?.reason).toBe('devils-deal');

    const mixed = JSON.parse(JSON.stringify(base)) as GameSession;
    mixed.secret.pile[3].cards[0] = { id: 'truth', kind: 'A' };
    const failed = applyCommand(mixed, { type: 'callDevilsDeal', actorId: 'alice' }, () => 0.25);
    expect(failed.session.state.roulette?.shooterIds).toEqual(['alice']);
  });

  it('keeps chaos hands after a successful challenge and only shoots the accused', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'chaos' },
      () => 0.25,
    );
    session.state.tableRank = 'K';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [
      { id: 'lie', kind: 'Q' },
      { id: 'host-kept', kind: 'K' },
    ]);
    rigHand(session, 'alice', [{ id: 'alice-kept', kind: 'K' }]);
    rigHand(session, 'bob', [{ id: 'bob-kept', kind: 'Q' }]);
    session.secret.fatalPulls.alice = 1;

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['lie'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);

    expect(challenged.session.state.roulette?.kind).toBe('targeted');
    expect(challenged.session.state.roulette?.fixedTargets).toEqual({ alice: 'host' });
    expect(challenged.session.state.roulette?.resume).toBe('continue');

    const shot = applyCommand(
      challenged.session,
      { type: 'pullTrigger', actorId: 'alice', targetId: 'bob' },
      () => 0.25,
    );
    expect(shot.session.state.players.host.alive).toBe(false);
    expect(shot.session.state.players.bob.alive).toBe(true);
    expect(shot.session.state.players.alice.safePulls).toBe(0);
    expect(shot.session.secret.fatalPulls.alice).toBe(2);

    const advanced = applyCommand(shot.session, { type: 'advanceResolution', actorId: 'host' }, () => 0.25);
    expect(advanced.session.state.round).toBe(1);
    expect(advanced.session.state.players.alice.handCount).toBe(1);
    expect(advanced.session.state.players.bob.handCount).toBe(1);
    expect(advanced.session.state.pileCount).toBe(0);
  });

  it('lets a revealed master shoot a chosen living opponent', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'chaos' },
      () => 0.25,
    );
    session.state.tableRank = 'K';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [{ id: 'master', kind: 'master' }]);
    rigHand(session, 'alice', [{ id: 'alice-card', kind: 'K' }]);
    rigHand(session, 'bob', [{ id: 'bob-card', kind: 'Q' }]);

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['master'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);

    expect(challenged.session.state.reveal?.reason).toBe('master');
    expect(challenged.session.state.roulette?.shooterIds).toEqual(['host']);
    expect(challenged.session.state.roulette?.fixedTargets).toEqual({});
    expect(
      applyCommand(challenged.session, { type: 'pullTrigger', actorId: 'host', targetId: 'bob' }, () => 0.25)
        .error,
    ).toBeUndefined();
  });

  it('rejects self-targets and eliminated targets for an open chaos shot', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'chaos' },
      () => 0.25,
    );
    session.state.tableRank = 'K';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [{ id: 'master', kind: 'master' }]);
    rigHand(session, 'alice', [{ id: 'alice-card', kind: 'K' }]);
    rigHand(session, 'bob', [{ id: 'bob-card', kind: 'Q' }]);

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['master'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);
    const selfTarget = applyCommand(
      challenged.session,
      { type: 'pullTrigger', actorId: 'host', targetId: 'host' },
      () => 0.25,
    );
    challenged.session.state.players.bob.alive = false;
    const eliminatedTarget = applyCommand(
      challenged.session,
      { type: 'pullTrigger', actorId: 'host', targetId: 'bob' },
      () => 0.25,
    );

    expect(selfTarget.error).toBe('请选择一名仍然活着的对手');
    expect(eliminatedTarget.error).toBe('请选择一名仍然活着的对手');
  });

  it('redeals after an incorrect chaos challenge', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'chaos' },
      () => 0.25,
    );
    session.state.tableRank = 'K';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [{ id: 'truth', kind: 'K' }]);
    rigHand(session, 'alice', [{ id: 'alice-card', kind: 'K' }]);
    rigHand(session, 'bob', [{ id: 'bob-card', kind: 'Q' }]);
    session.secret.fatalPulls.alice = 2;

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['truth'] }, () => 0.25);
    const challenged = applyCommand(played.session, { type: 'callLiar', actorId: 'alice' }, () => 0.25);
    const shot = applyCommand(challenged.session, { type: 'pullTrigger', actorId: 'alice' }, () => 0.25);
    const advanced = applyCommand(shot.session, { type: 'advanceResolution', actorId: 'host' }, () => 0.25);

    expect(challenged.session.state.roulette?.resume).toBe('redeal');
    expect(advanced.session.state.round).toBe(2);
    expect(Object.values(advanced.session.state.players).map((player) => player.handCount)).toEqual([3, 3, 3]);
  });

  it('reveals chaos immediately and resolves all committed shots simultaneously', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 3), ruleset: 'chaos' },
      () => 0.25,
    );
    session.state.tableRank = 'K';
    session.state.currentPlayerId = 'host';
    rigHand(session, 'host', [{ id: 'chaos', kind: 'chaos' }]);
    rigHand(session, 'alice', [{ id: 'alice-card', kind: 'K' }]);
    rigHand(session, 'bob', [{ id: 'bob-card', kind: 'Q' }]);
    session.secret.fatalPulls = { host: 1, alice: 1, bob: 1 };

    const played = applyCommand(session, { type: 'playCards', actorId: 'host', cardIds: ['chaos'] }, () => 0.25);
    expect(played.session.state.reveal?.reason).toBe('chaos');
    expect(played.session.state.roulette?.shooterIds).toEqual(['host', 'alice', 'bob']);

    const first = applyCommand(
      played.session,
      { type: 'pullTrigger', actorId: 'host', targetId: 'alice' },
      () => 0.25,
    );
    expect(first.session.secret.shotTargets).toEqual({ host: 'alice' });
    expect(first.session.state.roulette?.fixedTargets).toEqual({});
    expect(first.session.state.roulette?.committed).toEqual(['host']);
    expect(first.broadcasts).toEqual([]);
    const second = applyCommand(
      first.session,
      { type: 'pullTrigger', actorId: 'alice', targetId: 'bob' },
      () => 0.25,
    );
    expect(second.session.state.phase).toBe('roulette');
    const final = applyCommand(
      second.session,
      { type: 'pullTrigger', actorId: 'bob', targetId: 'host' },
      () => 0.25,
    );

    expect(final.session.state.phase).toBe('finished');
    expect(final.session.state.draw).toBe(true);
    expect(Object.values(final.session.state.players).every((player) => !player.alive)).toBe(true);
  });

  it('preserves wins across a host-started rematch', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 2), ruleset: 'classic' },
      () => 0.25,
    );
    session.state.players.host.wins = 2;
    let lobby = applyCommand(session, { type: 'abortMatch', actorId: 'host' }, () => 0.25).session;
    lobby = applyCommand(lobby, { type: 'setReady', actorId: 'host', ready: true }, () => 0.25).session;
    const restarted = applyCommand(lobby, { type: 'setReady', actorId: 'alice', ready: true }, () => 0.25);

    expect(restarted.session.state.phase).toBe('playing');
    expect(restarted.session.state.round).toBe(1);
    expect(restarted.session.state.players.host.wins).toBe(2);
  });

  it('lets only the host configure a lobby and starts when every seated player is ready', () => {
    let session = createMatch({ hostId: '', players: [], ruleset: 'classic', start: false }, () => 0.25);
    session = applyCommand(
      session,
      { type: 'playerJoined', actorId: 'host', player: players[0] },
      () => 0.25,
    ).session;
    session = applyCommand(
      session,
      { type: 'playerJoined', actorId: 'alice', player: players[1] },
      () => 0.25,
    ).session;

    const denied = applyCommand(
      session,
      { type: 'setRuleset', actorId: 'alice', ruleset: 'chaos' },
      () => 0.25,
    );
    expect(denied.error).toBe('只有房主可以切换规则');

    session = applyCommand(
      session,
      { type: 'setRuleset', actorId: 'host', ruleset: 'chaos' },
      () => 0.25,
    ).session;
    session = applyCommand(session, { type: 'setReady', actorId: 'host', ready: true }, () => 0.25).session;
    const started = applyCommand(
      session,
      { type: 'setReady', actorId: 'alice', ready: true },
      () => 0.25,
    );

    expect(started.session.state.phase).toBe('playing');
    expect(started.session.state.ruleset).toBe('chaos');
    expect(Object.values(started.session.state.players).map((player) => player.handCount)).toEqual([3, 3]);
    expect(started.sends.filter((effect) => effect.event === 'private:hand')).toHaveLength(2);
  });

  it('keeps active seats for reconnect, resends private state, and gives the host an abort escape hatch', () => {
    const session = createMatch(
      { hostId: 'host', players: players.slice(0, 2), ruleset: 'classic' },
      () => 0.25,
    );
    const disconnected = applyCommand(session, { type: 'playerLeft', actorId: 'alice' }, () => 0.25);
    expect(disconnected.session.state.players.alice.connected).toBe(false);
    expect(disconnected.session.state.seats).toContain('alice');

    const reconnected = applyCommand(
      disconnected.session,
      { type: 'playerReconnected', actorId: 'alice', name: 'Alice Again' },
      () => 0.25,
    );
    const synced = applyCommand(reconnected.session, { type: 'syncPrivate', actorId: 'alice' }, () => 0.25);
    expect(reconnected.session.state.players.alice.connected).toBe(true);
    expect(synced.sends[0]).toEqual({
      playerId: 'alice',
      event: 'private:hand',
      payload: { hand: reconnected.session.secret.hands.alice },
    });

    expect(
      applyCommand(reconnected.session, { type: 'abortMatch', actorId: 'alice' }, () => 0.25).error,
    ).toBe('只有房主可以中止牌局');
    const aborted = applyCommand(reconnected.session, { type: 'abortMatch', actorId: 'host' }, () => 0.25);
    expect(aborted.session.state.phase).toBe('lobby');
    expect(Object.values(aborted.session.state.players).every((player) => !player.ready && player.handCount === 0)).toBe(
      true,
    );
    expect(aborted.session.secret.hands).toEqual({});
  });
});
