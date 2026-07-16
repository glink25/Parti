import { describe, expect, it } from 'vitest';
import { MATCH_DURATION_MS } from './contracts';
import { canOccupy, canStart, createPlayer, firePlayer, findPath, hasLineOfSight, initialState, startMatch, stepGame } from './rules';

function lobby(count = 2) {
  const state = initialState();
  for (let index = 0; index < count; index++) {
    const id = `p${index + 1}`;
    state.players[id] = createPlayer(id, `Player ${index + 1}`, index);
    state.players[id].ready = true;
  }
  state.hostId = 'p1';
  return state;
}

describe('lobby and match setup', () => {
  it('requires all players to be ready', () => {
    const state = lobby();
    expect(canStart(state)).toBe(true);
    state.players.p2.ready = false;
    expect(canStart(state)).toBe(false);
  });

  it('requires balanced four-player teams for 2v2', () => {
    const state = lobby(4);
    state.config.mode = 'team2v2';
    expect(canStart(state)).toBe(true);
    state.players.p4.team = 'red';
    expect(canStart(state)).toBe(false);
  });

  it('creates player bases and a hidden twelve minute deadline', () => {
    const state = lobby();
    expect(startMatch(state, 1000)).toBe(true);
    expect(Object.keys(state.bases)).toHaveLength(2);
    expect(state.deadlineAt).toBe(1000 + MATCH_DURATION_MS);
    expect(Object.values(state.players).every((player) => player.alive)).toBe(true);
  });
});

describe('authority simulation', () => {
  it('blocks tanks from steel and water tiles', () => {
    const state = lobby(); startMatch(state, 0);
    expect(canOccupy(state, .5, .5)).toBe(false);
  });

  it('enforces fire cooldown and bullet limits at the authority', () => {
    const state = lobby(); startMatch(state, 0);
    expect(firePlayer(state, 'p1', 100)).toBe(true);
    expect(firePlayer(state, 'p1', 101)).toBe(false);
    expect(Object.keys(state.bullets)).toHaveLength(1);
  });

  it('does not let friendly fire damage a teammate in 2v2', () => {
    const state = lobby(4); state.config.mode = 'team2v2'; startMatch(state, 0);
    const shooter = state.players.p1; const teammate = state.players.p3;
    shooter.x = 5; shooter.y = 5; shooter.direction = 'right'; teammate.x = 5.75; teammate.y = 5; teammate.shieldUntil = 0;
    firePlayer(state, shooter.id, 1000); stepGame(state, 1050);
    expect(teammate.alive).toBe(true);
  });

  it('stops respawning a player after their base and last tank are destroyed', () => {
    const state = lobby(); startMatch(state, 0);
    state.bases['player:p1'].hp = 0;
    state.players.p1.alive = false;
    stepGame(state, 50);
    expect(state.players.p1.eliminated).toBe(true);
    expect(state.players.p1.respawnAt).toBeNull();
  });

  it('resolves a timed-out match using the documented tiebreak order', () => {
    const state = lobby(); startMatch(state, 0);
    state.players.p1.kills = 3; state.players.p2.kills = 1;
    state.deadlineAt = 10;
    stepGame(state, 11);
    expect(state.phase).toBe('finished');
    expect(state.result).toEqual({ winnerId: 'p1', draw: false, reason: 'timeout' });
  });

  it('delays AI arrival and replenishes at most one AI every 18–25 seconds', () => {
    const state = lobby(); startMatch(state, 1000);
    stepGame(state, 15999);
    expect(Object.keys(state.ai)).toHaveLength(0);
    stepGame(state, 16000);
    expect(Object.keys(state.ai)).toHaveLength(1);
    const next = state.nextAiSpawnAt;
    expect(next - 16000).toBeGreaterThanOrEqual(18000);
    expect(next - 16000).toBeLessThanOrEqual(25000);
    stepGame(state, next - 1);
    expect(Object.keys(state.ai)).toHaveLength(1);
    stepGame(state, next);
    expect(Object.keys(state.ai)).toHaveLength(2);
    stepGame(state, state.nextAiSpawnAt);
    expect(Object.keys(state.ai)).toHaveLength(3);
    stepGame(state, state.nextAiSpawnAt + 30000);
    expect(Object.keys(state.ai)).toHaveLength(3);
  });

  it('requires short aligned unobstructed sight before an AI can fire', () => {
    const state = lobby(); startMatch(state, 0); stepGame(state, 15000);
    const ai = Object.values(state.ai)[0]; const target = state.players.p1;
    state.destroyedTiles = Array.from({ length: 26 * 20 }, (_, index) => index);
    Object.assign(ai, { x: 5.5, y: 5.5 }); Object.assign(target, { x: 5.5, y: 11.5, alive: true });
    expect(hasLineOfSight(state, ai, target)).toBe('down');
    target.x = 6.5;
    expect(hasLineOfSight(state, ai, target)).toBeNull();
    Object.assign(target, { x: 5.5, y: 13.5 });
    expect(hasLineOfSight(state, ai, target)).toBeNull();
  });

  it('keeps only one live bullet per AI and uses the long cooldown', () => {
    const state = lobby(); startMatch(state, 0); stepGame(state, 15000);
    const ai = Object.values(state.ai)[0]; const target = state.players.p1;
    state.destroyedTiles = Array.from({ length: 26 * 20 }, (_, index) => index);
    Object.assign(ai, { x: 5.5, y: 5.5, nextFireAt: 15000, nextDecisionAt: 99999, targetPlayerId: target.id });
    Object.assign(target, { x: 5.5, y: 9.5, alive: true });
    stepGame(state, 15001);
    expect(Object.keys(state.bullets)).toHaveLength(1);
    expect(ai.bulletId).not.toBeNull();
    expect(ai.nextFireAt - 15001).toBeGreaterThanOrEqual(2500);
    expect(ai.nextFireAt - 15001).toBeLessThanOrEqual(4000);
    stepGame(state, 15101);
    expect(Object.keys(state.bullets)).toHaveLength(1);
  });

  it('routes around permanent walls instead of selecting blocked nodes', () => {
    const state = lobby(); startMatch(state, 0);
    const path = findPath(state, state.players.p1, { x: 13.5, y: 10.5 });
    expect(path.length).toBeGreaterThan(0);
    expect(path.every((point) => canOccupy(state, point.x, point.y))).toBe(true);
  });

  it('fortifies protection bricks without making the base itself invulnerable', () => {
    const state = lobby(); startMatch(state, 0);
    const base = state.bases['player:p2']; base.fortifiedUntil = 10000;
    const tile = base.protectionTiles[0];
    state.bullets.wall = { id: 'wall', ownerId: 'p1', ownerKind: 'player', direction: 'right', x: tile % 26 + .5, y: Math.floor(tile / 26) + .5, speed: 0, steelPiercing: false };
    stepGame(state, 100);
    expect(state.destroyedTiles).not.toContain(tile);
    state.bullets.base = { id: 'base', ownerId: 'p1', ownerKind: 'player', direction: 'right', x: base.x, y: base.y, speed: 0, steelPiercing: false };
    stepGame(state, 200);
    expect(base.hp).toBe(2);
  });
});
