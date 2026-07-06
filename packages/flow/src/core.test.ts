import { describe, expect, it, vi } from 'vitest';
import { createGameRuntime, createPartiSyncPlugin, type PartiClientApi } from '.';

describe('PartiFlow core', () => {
  it('manages components and deterministic systems', () => {
    const game = createGameRuntime({ playerId: 'p1' }); const calls: number[] = [];
    game.world.spawn({ id: 'player', components: { Transform: { x: 1 }, Health: 3 } });
    game.world.patchComponent<{ x: number }>('player', 'Transform', { x: 2 });
    expect(game.world.entitiesWith('Transform', 'Health')).toEqual(['player']);
    expect(game.world.getComponent('player', 'Transform')).toEqual({ x: 2 });
    game.addSystem({ update: () => calls.push(1) }); game.addSystem({ update: () => calls.push(2) }); game.update(.1);
    expect(calls).toEqual([1, 2]);
  });
  it('dispatches immediate actions, defers authoritative actions, and deduplicates', () => {
    const game = createGameRuntime({ playerId: 'p1' }); const seen: string[] = [];
    game.actions.define<{ value: string }>('local', { sync: { mode: 'optimisticBroadcast' } }, (_, payload) => seen.push(payload.value));
    game.actions.define('start', { sync: { mode: 'hostAuthoritative' } }, () => seen.push('start'));
    const action = game.action('local', { value: 'one' }); game.actions.dispatch('local', { value: 'duplicate' }, action);
    game.action('start'); expect(seen).toEqual(['one']);
    game.actions.dispatch('start', null, { id: 'host:1', from: 'host', origin: 'host', seq: 1 }); expect(seen).toEqual(['one', 'start']);
    expect(action.id).toBe('p1:1');
  });
  it('matches state rules, rejects stale versions, and applies snapshots', () => {
    const applied: unknown[] = []; const game = createGameRuntime({ playerId: 'p', stateAdapter: { get: () => undefined, set: (path, value, options) => applied.push([path, value, options?.remoteApply]) } });
    game.state.define('players.*.position', { sync: { mode: 'ownerInterval', remoteApply: 'smooth' } });
    expect(game.state.patch({ path: 'players.p2.position', value: { x: 1 }, version: 2 })).toBe(true);
    expect(game.state.patch({ path: 'players.p2.position', value: { x: 0 }, version: 1 })).toBe(false);
    game.state.snapshot({ phase: 'running', boss: { hp: 5 } });
    expect(game.state.get('phase')).toBe('running'); expect(applied[0]).toEqual(['players.p2.position', { x: 1 }, 'smooth']);
  });
});

describe('Parti adapter', () => {
  it('sends policies, replays host actions without loops, snapshots, and disposes', () => {
    const states = new Set<(v: unknown) => void>(); const events = new Set<(v: unknown) => void>();
    const api: PartiClientApi = { playerId: 'p1', getState: () => null, action: vi.fn(async () => ({ ok: true as const })), onState: (fn) => { states.add(fn); return () => states.delete(fn); }, onEvent: (_, fn) => { events.add(fn); return () => events.delete(fn); } };
    const game = createGameRuntime({ playerId: 'p1' }); const values: string[] = [];
    game.actions.define<string>('fx', { sync: { mode: 'localOnly' } }, (_, p) => values.push(p));
    game.actions.define<string>('shoot', { sync: { mode: 'optimisticBroadcast' } }, (_, p) => values.push(p));
    game.actions.define<string>('start', { sync: { mode: 'hostAuthoritative' } }, (_, p) => values.push(p));
    game.state.define('players.*.position', { sync: { mode: 'ownerInterval' } });
    game.use(createPartiSyncPlugin(api)); game.action('fx', 'fx'); game.action('shoot', 'local'); game.action('start', 'request');
    expect(api.action).toHaveBeenCalledTimes(2); expect(values).toEqual(['fx', 'local']);
    for (const fn of events) fn({ action: { id: 'host:1', type: 'start', payload: 'started', from: 'host', seq: 1, origin: 'host', createdAt: 1 } });
    expect(values).toEqual(['fx', 'local', 'started']); expect(api.action).toHaveBeenCalledTimes(2);
    for (const fn of states) fn({ phase: 'running' }); expect(game.state.get('phase')).toBe('running');
    game.state.set('players.p1.position', { x: 1 }); expect(api.action).toHaveBeenCalledWith('partiflow:state', expect.objectContaining({ path: 'players.p1.position' }));
    game.dispose(); expect(states.size).toBe(0); expect(events.size).toBe(0);
  });
});
