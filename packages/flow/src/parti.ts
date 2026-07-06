import type { GameAction, GamePlugin, GameRuntime, StatePatch } from './types';
export const PARTI_FLOW_ACTION_EVENT = 'partiflow:action';
export const PARTI_FLOW_EVENT = 'partiflow:event';
export const PARTI_FLOW_REJECT_EVENT = 'partiflow:reject';
export const PARTI_FLOW_PAYLOAD = '__partiflow';
export interface PartiClientApi { playerId: string | null; getState(): unknown; onState(handler: (state: unknown) => void): () => void; onEvent(event: string, handler: (payload: unknown) => void): () => void; action(action: string, payload?: unknown): Promise<{ ok: true }> }
export interface PartiActionEnvelope { action: GameAction }
export function createPartiSyncPlugin(api: PartiClientApi, options: { event?: string; stateAction?: string } = {}): GamePlugin {
  return { name: 'parti-sync', install(game: GameRuntime) { const event = options.event ?? PARTI_FLOW_ACTION_EVENT; const stateAction = options.stateAction ?? 'partiflow:state'; const timers = new Map<string, ReturnType<typeof setTimeout>>(); const sentAt = new Map<string, number>();
    const sendPatch = (patch: StatePatch) => { void api.action(stateAction, patch); sentAt.set(patch.path, Date.now()); };
    const offDispatch = game.actions.onAfterDispatch((action) => { if (action.origin !== 'local') return; const policy = game.actions.getPolicy(action.type); if (policy?.mode !== 'localOnly') void api.action(action.type, { [PARTI_FLOW_PAYLOAD]: action }); });
    const offPatch = game.state.onChange((patch) => { if (patch.from === 'host' || patch.from === 'remote') return; const rule = game.state.config(patch.path)?.sync; if (!rule || rule.mode === 'hostInterval') return; const interval = rule.intervalMs ?? 0, wait = Math.max(0, interval - (Date.now() - (sentAt.get(patch.path) ?? 0))); if (!wait) sendPatch(patch); else { const existing = timers.get(patch.path); if (existing) clearTimeout(existing); timers.set(patch.path, setTimeout(() => { timers.delete(patch.path); sendPatch(patch); }, wait)); } });
    const offAction = api.onEvent(event, (raw) => { const action = (raw as PartiActionEnvelope | null)?.action; if (!action || action.from === game.playerId && action.origin !== 'host') return; game.actions.dispatch(action.type, action.payload, { ...action, origin: action.origin === 'host' ? 'host' : 'remote' }); });
    const offEvent = api.onEvent(PARTI_FLOW_EVENT, (raw) => { const value = raw as { type?: string; payload?: unknown }; if (value?.type) game.events.emit(value.type, value.payload); });
    const offReject = api.onEvent(PARTI_FLOW_REJECT_EVENT, (payload) => game.events.emit(PARTI_FLOW_REJECT_EVENT, payload));
    const offState = api.onState((state) => { if (state != null) game.state.snapshot(state); });
    return () => { offDispatch(); offPatch(); offAction(); offEvent(); offReject(); offState(); for (const timer of timers.values()) clearTimeout(timer); timers.clear(); };
  } };
}
export function flowEnvelope<T>(type: string, payload: T, options: { id: string; from: string; seq: number; createdAt?: number }): PartiActionEnvelope { return { action: { id: options.id, type, payload, from: options.from, seq: options.seq, origin: 'host', createdAt: options.createdAt ?? Date.now() } }; }
