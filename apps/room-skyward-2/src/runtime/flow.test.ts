import { describe, expect, it, vi } from 'vitest';
import { PARTI_FLOW_ACTION_EVENT, flowEnvelope } from '@parti/flow';
import type { GameState, PartiApi } from '../game/contracts';
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
