import { defineRoom, type RoomContext, type RoomDefinition, type RoomPlayer } from '@parti/worker-sdk';
import { PARTI_FLOW_ACTION_EVENT, PARTI_FLOW_PAYLOAD, PARTI_FLOW_REJECT_EVENT } from './parti';
import type { FlowPlayer, FlowReducerContext, GameAction, GameDefinition } from './types';

type WirePayload = { [PARTI_FLOW_PAYLOAD]?: GameAction };
const asPlayer = (player: RoomPlayer): FlowPlayer => player;

export function createFlowRoom<State>(game: GameDefinition<State>): RoomDefinition<State> {
  let sequence = 0;
  const makeAction = (type: string, payload: unknown, actor: FlowPlayer, id?: string): GameAction => { const seq = ++sequence; return { id: id ?? `${actor.id}:authority:${seq}`, type, payload, from: actor.id, seq, origin: 'host', createdAt: Date.now() }; };
  const execute = (room: RoomContext<State>, action: GameAction, actor: FlowPlayer, validate = true): boolean => {
    const definition = game.actions[action.type]; if (!definition) return false;
    if (definition.sync.mode === 'localOnly') { room.send(actor.id, PARTI_FLOW_REJECT_EVENT, { actionId: action.id, reason: 'local-only' }); return false; }
    const context = makeContext(room, actor);
    let payload = action.payload;
    if (validate && definition.validate) { const result = definition.validate(context, payload); if (!result.ok) { room.send(actor.id, PARTI_FLOW_REJECT_EVENT, { actionId: action.id, reason: result.reason }); return false; } payload = result.payload; }
    const authoritative = { ...action, payload, origin: 'host' as const, createdAt: room.now() };
    if (definition.sync.mode !== 'optimisticBroadcast') definition.reduce(context, payload, authoritative);
    room.broadcast(PARTI_FLOW_ACTION_EVENT, { action: authoritative });
    return true;
  };
  const makeContext = (room: RoomContext<State>, actor: FlowPlayer): FlowReducerContext<State> => ({
    state: room.state, role: 'authority', actor, players: room.players.map(asPlayer), host: asPlayer(room.host), now: room.now, random: room.random,
    timers: { dispatch(name, delay, type, payload, actorId) { room.setTimer(name, delay, () => { const timerActor = room.players.find((p) => p.id === actorId) ?? room.host; execute(room, makeAction(type, payload ?? null, asPlayer(timerActor)), asPlayer(timerActor), false); }); }, clear: room.clearTimer },
    emit() {},
    dispatch(type, payload, actorId) { const nestedActor = room.players.find((p) => p.id === actorId) ?? room.host; execute(room, makeAction(type, payload ?? null, asPlayer(nestedActor)), asPlayer(nestedActor), false); },
    kick: room.kick,
  });
  const startSystems = (room: RoomContext<State>) => { for (const [index, system] of (game.systems ?? []).entries()) { if (system.runOn === 'client') continue; const interval = system.intervalMs ?? 50, name = `partiflow:system:${index}`; const tick = () => { system.update(makeContext(room, asPlayer(room.host)), interval / 1000); room.setTimer(name, interval, tick); }; room.setTimer(name, interval, tick); } };
  const actions = Object.fromEntries(Object.keys(game.actions).map((type) => [type, (room: RoomContext<State>, event: { player: RoomPlayer; payload: unknown; actionId: string }) => { const wire = event.payload as WirePayload | null; const incoming = wire?.[PARTI_FLOW_PAYLOAD]; const actor = asPlayer(event.player); execute(room, incoming ? { ...incoming, from: actor.id } : makeAction(type, event.payload, actor, event.actionId), actor); }]));
  actions['partiflow:state'] = (room: RoomContext<State>, event: { player: RoomPlayer; payload: any }) => { const patch = event.payload; if (!patch || typeof patch.path !== 'string') return; const path = patch.path.split('.'); const rule = Object.entries(game.state ?? {}).find(([pattern]) => { const expected = pattern.split('.'); return expected.length === path.length && expected.every((part, index) => part === '*' || part === path[index]); }); if (!rule || rule[1].write !== 'owner') { room.send(event.player.id, PARTI_FLOW_REJECT_EVENT, { reason: 'state-not-writable', path: patch.path }); return; } const wildcard = rule[0].split('.').indexOf('*'); if (wildcard < 0 || path[wildcard] !== event.player.id) { room.send(event.player.id, PARTI_FLOW_REJECT_EVENT, { reason: 'not-state-owner', path: patch.path }); return; } let target: any = room.state; for (const key of path.slice(0, -1)) target = target?.[key]; if (target && path.length) target[path.at(-1)!] = patch.value; };
  return defineRoom<State>({ meta: game.meta, initialState: game.initialState,
    onCreate(room) { game.lifecycle?.create?.(makeContext(room, asPlayer(room.host))); startSystems(room); },
    onRestore(room) { game.lifecycle?.restore?.(makeContext(room, asPlayer(room.host))); startSystems(room); },
    onJoin(room, player) { game.lifecycle?.join?.(makeContext(room, asPlayer(player)), asPlayer(player)); },
    onReconnect(room, player) { game.lifecycle?.reconnect?.(makeContext(room, asPlayer(player)), asPlayer(player)); },
    onLeave(room, player) { game.lifecycle?.leave?.(makeContext(room, asPlayer(player)), asPlayer(player)); },
    onReady(room, player) { game.lifecycle?.ready?.(makeContext(room, asPlayer(player)), asPlayer(player)); }, actions,
  });
}
