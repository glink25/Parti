import { describe, expect, it, vi } from 'vitest';
import { accept, defineGame, reject, type FlowReducerContext } from './types';
import { PARTI_FLOW_ACTION_EVENT, PARTI_FLOW_PAYLOAD, PARTI_FLOW_REJECT_EVENT } from './parti';
import { createFlowRoom } from './worker';

type State = { count: number; joined: string[] };
const host = { id: 'host', name: 'Host', role: 'host' as const };
const player = { id: 'p1', name: 'P1', role: 'player' as const };
function room(state: State) { const timers = new Map<string, () => void>(); return { state, players: [host, player], host, now: () => 100, random: () => .5, broadcast: vi.fn(), send: vi.fn(), kick: vi.fn(), log: vi.fn(), setTimer: vi.fn((name: string, _ms: number, cb: () => void) => timers.set(name, cb)), clearTimer: vi.fn((name: string) => timers.delete(name)), timers }; }

describe('createFlowRoom', () => {
  it('maps lifecycle, validates, normalizes, reduces, relays, and preserves action ids', () => {
    const reduce = vi.fn((ctx: FlowReducerContext<State>, payload: { amount: number }) => { ctx.state.count += payload.amount; });
    const definition = defineGame<State>({ initialState: () => ({ count: 0, joined: [] }), lifecycle: { join(ctx, joined) { ctx.state.joined.push(joined.id); } }, actions: {
      add: { sync: { mode: 'hostRelay' }, validate: (_, payload: { amount: number }) => payload.amount > 0 ? accept({ amount: Math.min(3, payload.amount) }) : reject('positive-only'), reduce },
      ping: { sync: { mode: 'optimisticBroadcast' }, reduce },
    } });
    const generated = createFlowRoom(definition), state = generated.initialState({}), ctx = room(state);
    generated.onJoin?.(ctx, player); expect(state.joined).toEqual(['p1']);
    generated.actions?.add?.(ctx, { player, actionId: 'transport-id', payload: { [PARTI_FLOW_PAYLOAD]: { id: 'client:7', type: 'add', payload: { amount: 9 }, from: 'p1', seq: 7, origin: 'local', createdAt: 1 } } });
    expect(state.count).toBe(3); expect(reduce).toHaveBeenCalledOnce(); expect(ctx.broadcast).toHaveBeenCalledWith(PARTI_FLOW_ACTION_EVENT, { action: expect.objectContaining({ id: 'client:7', payload: { amount: 3 }, origin: 'host' }) });
    generated.actions?.ping?.(ctx, { player, actionId: 'ping:1', payload: { amount: 1 } }); expect(reduce).toHaveBeenCalledOnce();
    generated.actions?.add?.(ctx, { player, actionId: 'bad:1', payload: { amount: 0 } }); expect(ctx.send).toHaveBeenCalledWith('p1', PARTI_FLOW_REJECT_EVENT, { actionId: 'bad:1', reason: 'positive-only' });
    generated.actions?.['partiflow:state']?.(ctx, { player, actionId: 'state:1', payload: { path: 'count', value: 99 } }); expect(state.count).toBe(3); expect(ctx.send).toHaveBeenCalledWith('p1', PARTI_FLOW_REJECT_EVENT, { reason: 'state-not-writable', path: 'count' });
  });
});
