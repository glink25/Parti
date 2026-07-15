import { describe, expect, it } from 'vitest';
import type { GameState, PartiApi } from '../game/contracts';
import { generateStage } from '../game/roguelike';
import { generateEquipment } from '../game/rules/equipment';
import { initialState, player, testMonster } from '../game/rules/state';
import { createEndwellFlow, createEndwellFlowWhenReady } from './flow';

function apiHarness(initialPlayerId: string | null = 'p1') {
  const stateHandlers = new Set<(state: unknown) => void>(), eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  let currentState: GameState | null = null;
  const api: PartiApi = { playerId: initialPlayerId, getState: () => currentState, onState(handler) { stateHandlers.add(handler); if (currentState) handler(currentState); return () => stateHandlers.delete(handler); }, onEvent(event, handler) { const handlers = eventHandlers.get(event) ?? new Set(); handlers.add(handler); eventHandlers.set(event, handlers); return () => handlers.delete(handler); }, async action() { return { ok: true }; }, ready() {}, leave() {} };
  return { api, identify: (playerId: string) => { api.playerId = playerId; }, state: (state: GameState) => { currentState = state; for (const handler of stateHandlers) handler(state); } };
}

describe('local-first flow', () => {
  it('waits for the assigned client identity before creating the runtime', () => {
    const harness = apiHarness(null), authority = initialState();
    authority.phase = 'running';
    authority.run.stage = generateStage(17, 0);
    authority.players.p1 = player('p1', 'one', 0);
    authority.players.p1.position = { ...authority.run.stage.world.spawn };
    let flow: ReturnType<typeof createEndwellFlow> | null = null, visible: GameState | null = null;
    const stopWaiting = createEndwellFlowWhenReady(harness.api, { state: (state) => { visible = state; }, event() {} }, (created) => { flow = created; });

    expect(flow).toBeNull();
    harness.identify('p1');
    harness.state(structuredClone(authority));

    expect(flow!.game.playerId).toBe('p1');
    expect(visible!.players.p1).toMatchObject({ alive: true, health: { current: 100, max: 100 } });
    stopWaiting();
    flow!.game.dispose();
  });

  it('keeps prediction internal and preserves activation and hits across stale snapshots', () => {
    const harness = apiHarness(), authority = initialState(), stage = generateStage(17, 0), caster = authority.players.p1 = player('p1', 'one', 0), monster = testMonster(0); authority.phase = 'running'; authority.run.stage = stage; caster.position = { ...stage.world.spawn }; monster.position = { x: caster.position.x + 100, y: caster.position.y }; authority.entities[monster.id] = monster;
    let visible: GameState | null = null; const flow = createEndwellFlow(harness.api, { state: (state) => { visible = state; }, event() {} }); harness.state(structuredClone(authority));
    const predicted = () => flow.game.state.get<GameState>('')!; const { castId } = flow.cast(1, ['fire'], { x: 1, y: 0 }, monster.position); expect(predicted().players.p1!.cast.phase).toBe('chanting'); expect(visible!.players.p1!.cast.phase).toBe('idle'); const beforeActivation = structuredClone(authority); flow.activate(castId); const sourceId = `${castId}:spray:0`; expect(predicted().entities[sourceId]).toBeDefined();
    harness.state(beforeActivation); expect(visible!.entities[sourceId]).toBeDefined();
    const beforeHit = structuredClone(visible!); const health = visible!.entities[monster.id]!.health.current, hitId = `${sourceId}:hit:${monster.id}:1`; flow.hit({ hitId, sourceId, targetId: monster.id, tick: 1, reason: 'hit' }); expect(predicted().entities[monster.id]!.health.current).toBeLessThan(health);
    harness.state(beforeHit); expect(visible!.entities[monster.id]!.health.current).toBeLessThan(health); expect(visible!.seen.hits[hitId]).toBe(true); flow.game.dispose();
  });

  it('updates every player transform immediately when a start action changes position epochs', () => {
    const harness = apiHarness(), lobby = initialState(); lobby.hostId = 'p1'; lobby.players.p1 = player('p1', 'one', 0); lobby.players.p2 = player('p2', 'two', 1); const flow = createEndwellFlow(harness.api, { state() {}, event() {} }); harness.state(structuredClone(lobby)); flow.game.update(.016);
    flow.game.actions.dispatch('game.start', null, { id: 'start:confirmed', origin: 'host', from: 'p1' }); flow.game.update(.016); const state = flow.game.state.get<GameState>('')!;
    for (const player of Object.values(state.players)) { expect(flow.game.world.getComponent(player.id, 'Transform')).toEqual(player.position); expect(flow.game.world.getComponent(player.id, 'PositionEpoch')).toBe(player.positionEpoch); }
    flow.game.dispose();
  });

  it('keeps equipment mutations stable while an older authority snapshot is in flight', () => { const harness = apiHarness(), authority = initialState(), stage = authority.run.stage = generateStage(23, 0), p = authority.players.p1 = player('p1', 'one', 0), item = generateEquipment(23, 0); authority.phase = 'running'; p.position = { ...stage.world.spawn }; p.inventory.push(item); let visible: GameState | null = null; const flow = createEndwellFlow(harness.api, { state: (state) => { visible = state; }, event() {} }); harness.state(structuredClone(authority)); flow.equip(item.id); expect(flow.game.state.get<GameState>('')!.players.p1!.equipment[item.slot]?.id).toBe(item.id); harness.state(structuredClone(authority)); expect(visible!.players.p1!.equipment[item.slot]?.id).toBe(item.id); const confirmed = structuredClone(authority); confirmed.players.p1!.inventory = []; confirmed.players.p1!.equipment[item.slot] = item; harness.state(confirmed); expect(visible!.players.p1!.equipment[item.slot]?.id).toBe(item.id); flow.unequip(item.id); harness.state(structuredClone(confirmed)); expect(visible!.players.p1!.inventory.some((entry) => entry.id === item.id)).toBe(true); flow.game.dispose(); });
});
