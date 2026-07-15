import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PARTI_FLOW_ACTION_EVENT, flowEnvelope } from '@parti/flow';
import type { BossEncounter, GameState, PartiApi, PublicPlayer } from '../game/contracts';
import { BOSS_TRIGGER_OFFSET, CHUNK_HEIGHT } from '../game/contracts';
import { createSkywardFlow } from './flow';

describe('Skyward PartiFlow integration', () => {
  it('routes local actions, authoritative replay, snapshots, and world entities', () => {
    const stateHandlers = new Set<(state: unknown) => void>(); const eventHandlers = new Map<string, (payload: unknown) => void>();
    const action = vi.fn(async () => ({ ok: true as const }));
    const api = { playerId: 'p1', getState: () => null, action, onState: (handler: (state: unknown) => void) => { stateHandlers.add(handler); return () => stateHandlers.delete(handler); }, onEvent: (event: string, handler: (payload: unknown) => void) => { eventHandlers.set(event, handler); return () => eventHandlers.delete(event); }, ready() {}, leave() {} } satisfies PartiApi;
    const localShot = vi.fn(), remoteShot = vi.fn(), receiveState = vi.fn();
    const flow = createSkywardFlow(api, { state: receiveState, pose: vi.fn(), shot: remoteShot, localShot, pickup: vi.fn(), death: vi.fn(), bossDefeated: vi.fn(), outcome: vi.fn() });
    flow.shoot({ shotId: 'p1:shot:1', x: 2, y: 3 });
    expect(localShot).toHaveBeenCalledOnce(); expect(action).toHaveBeenCalledWith('shoot', { __partiflow: expect.objectContaining({ type: 'shoot', payload: { shotId: 'p1:shot:1', x: 2, y: 3 } }) }); expect(flow.game.world.has('p1:shot:1')).toBe(true);
    eventHandlers.get(PARTI_FLOW_ACTION_EVENT)?.(flowEnvelope('shoot', { shotId: 'p2:shot:1', x: 4, y: 5, damage: 1, spread: false, pierce: false }, { id: 'host:1', from: 'p2', seq: 1 }));
    expect(remoteShot).toHaveBeenCalledOnce(); expect(flow.game.world.has('p2:shot:1')).toBe(true);
    const state = { players: { p1: { id: 'p1', x: 10, y: 20 } } } as unknown as GameState; for (const handler of stateHandlers) handler(state);
    expect(receiveState).toHaveBeenCalledWith(state); expect(flow.game.world.getComponent('p1', 'Transform')).toEqual({ x: 10, y: 20 });
    flow.game.dispose(); expect(stateHandlers.size).toBe(0); expect(eventHandlers.size).toBe(0);
  });
});

function playerFixture(id: string, y: number, connected = true): PublicPlayer {
  return { id, name: id, ready: true, connected, alive: true, respawnAt: null, invulnerableUntil: 0, x: 450, y, vy: 0, cameraBottom: 0, direction: 0, positionEpoch: 0, kills: 0, deaths: 0, shots: 0, killStreak: 0, noDamageHeight: 0, tilt: false, lastHitSequence: 0, lastOutcomeSequence: 0, effects: {} };
}
function runningState(players: Record<string, PublicPlayer>): GameState {
  return { schemaVersion: 2, contentFingerprint: '', phase: 'running', hostId: Object.keys(players)[0]!, seed: 42, startedAt: 0, startedPlayers: Object.keys(players), players, teamVoidY: 0, highestY: 0, completedBossCount: 0, entities: {}, boss: null, bestRun: { height: 0, bosses: 0, kills: 0, noDamageHeight: 0 }, message: '' };
}
function setupFlow(playerId: string, state: GameState) {
  const stateHandlers = new Set<(state: unknown) => void>(); const eventHandlers = new Map<string, (payload: unknown) => void>();
  const action = vi.fn(async () => ({ ok: true as const }));
  const api = { playerId, getState: () => null, action, onState: (handler: (state: unknown) => void) => { stateHandlers.add(handler); return () => stateHandlers.delete(handler); }, onEvent: (event: string, handler: (payload: unknown) => void) => { eventHandlers.set(event, handler); return () => eventHandlers.delete(event); }, ready() {}, leave() {} } satisfies PartiApi;
  const flow = createSkywardFlow(api, { state: () => {}, pose: () => {}, shot: () => {}, localShot: () => {}, pickup: () => {}, death: () => {}, bossDefeated: () => {}, outcome: () => {} });
  flow.game.state.snapshot(state);
  for (const handler of stateHandlers) handler(state);
  return { flow, getState: () => flow.game.state.get<GameState>('')!, action };
}

describe('boss encounter sync', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
  afterEach(() => { vi.useRealTimers(); });

  const bossChunk = 11, triggerY = bossChunk * CHUNK_HEIGHT + BOSS_TRIGGER_OFFSET, poseAbove = (seq: number) => ({ sequence: seq, x: 450, y: triggerY + 100, vy: 100, cameraBottom: triggerY - 1100, direction: 0 });

  it('starts the boss encounter once the lone player reaches the trigger Y', () => {
    const { flow, getState } = setupFlow('p1a', runningState({ p1a: playerFixture('p1a', 100) }));
    flow.publishPose(poseAbove(1));
    const boss = getState().boss as NonNullable<BossEncounter>;
    expect(boss).not.toBeNull();
    expect(boss.chunkIndex).toBe(bossChunk);
  });

  it('holds boss spawn until every online player has reached the trigger Y', () => {
    const { flow, getState } = setupFlow('p1b', runningState({ p1b: playerFixture('p1b', 100), p2b: playerFixture('p2b', 100) }));
    flow.publishPose(poseAbove(1));
    expect(getState().boss).toBeNull();
  });

  it('starts the boss once the lagging teammate catches up via a later pose', () => {
    const { flow, getState } = setupFlow('p1c', runningState({ p1c: playerFixture('p1c', 100), p2c: playerFixture('p2c', 100) }));
    flow.publishPose(poseAbove(1));
    expect(getState().boss).toBeNull();
    vi.setSystemTime(2000);
    flow.game.state.set('players.p2c', playerFixture('p2c', triggerY + 100));
    flow.publishPose(poseAbove(2));
    expect(getState().boss).not.toBeNull();
  });

  it('ignores offline players when checking arrival', () => {
    const { flow, getState } = setupFlow('p1d', runningState({ p1d: playerFixture('p1d', 100), p2d: playerFixture('p2d', 100, false) }));
    flow.publishPose(poseAbove(1));
    expect(getState().boss).not.toBeNull();
  });

});
