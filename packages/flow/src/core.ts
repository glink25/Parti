import type { ActionConfig, ActionHandler, ActionRegistry, EntityCreateOptions, EntityId, EventBus, FlowPlayer, FlowReducerContext, GameAction, GameDefinition, GamePlugin, GameRuntime, GameSystem, StateAdapter, StatePatch, StateStore, StateSyncConfig, World } from './types';

function serializable(value: unknown): boolean { try { if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return false; JSON.stringify(value); return true; } catch { return false; } }

export class WorldImpl implements World {
  private entities = new Map<string, { type?: string; components: Map<string, unknown> }>(); private next = 0;
  spawn(options: EntityCreateOptions) { const id = options.id ?? `entity:${++this.next}`; if (this.entities.has(id)) throw new Error(`Entity already exists: ${id}`); this.entities.set(id, { ...(options.type ? { type: options.type } : {}), components: new Map(Object.entries(options.components ?? {})) }); return id; }
  destroy(id: EntityId) { this.entities.delete(id); } has(id: EntityId) { return this.entities.has(id); }
  getComponent<T>(id: EntityId, name: string) { return this.entities.get(id)?.components.get(name) as T | undefined; }
  setComponent<T>(id: EntityId, name: string, value: T) { const entity = this.entities.get(id); if (!entity) throw new Error(`Unknown entity: ${id}`); entity.components.set(name, value); }
  patchComponent<T extends object>(id: EntityId, name: string, patch: Partial<T>) { this.setComponent(id, name, { ...(this.getComponent<T>(id, name) ?? {} as T), ...patch }); }
  entitiesWith(...components: string[]) { return [...this.entities].filter(([, entity]) => components.every((name) => entity.components.has(name))).map(([id]) => id); }
}

export class EventBusImpl implements EventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  emit<T>(type: string, payload: T) { for (const handler of this.handlers.get(type) ?? []) handler(payload); }
  on<T>(type: string, handler: (payload: T) => void) { const set = this.handlers.get(type) ?? new Set(); set.add(handler as (payload: unknown) => void); this.handlers.set(type, set); return () => { set.delete(handler as (payload: unknown) => void); }; }
  clear() { this.handlers.clear(); }
}

const parts = (path: string) => path ? path.split('.') : [];
function read(root: unknown, path: string): unknown { return parts(path).reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, root); }
function write(root: Record<string, unknown>, path: string, value: unknown) { const keys = parts(path); let cursor = root; for (const key of keys.slice(0, -1)) { const next = cursor[key]; cursor = next && typeof next === 'object' ? next as Record<string, unknown> : (cursor[key] = {}) as Record<string, unknown>; } if (keys.length) cursor[keys.at(-1)!] = value; }
function matches(pattern: string, path: string) { const a = parts(pattern), b = parts(path); return a.length === b.length && a.every((part, i) => part === '*' || part === b[i]); }

export class StateStoreImpl implements StateStore {
  private data: Record<string, unknown> = {}; private rules: Array<[string, StateSyncConfig]> = []; private listeners = new Set<(patch: StatePatch) => void>(); private versions = new Map<string, number>();
  constructor(private adapter?: StateAdapter) {}
  get<T>(path: string) { return (this.adapter?.get(path) ?? read(this.data, path)) as T | undefined; }
  set<T>(path: string, value: T) { this.patch({ path, value }); }
  patch(patch: StatePatch) { const previous = this.versions.get(patch.path) ?? -1; if (patch.version != null && patch.version <= previous) return false; if (patch.version != null) this.versions.set(patch.path, patch.version); const rule = this.config(patch.path); const apply = patch.apply ?? rule?.sync.remoteApply ?? 'replace'; if (apply === 'ignoreIfLocalOwner' && patch.from === 'local') return false; const current = this.get(patch.path); const value = apply === 'merge' && current && patch.value && typeof current === 'object' && typeof patch.value === 'object' ? { ...current as object, ...patch.value as object } : patch.value; write(this.data, patch.path, value); this.adapter?.set(patch.path, value, { remoteApply: apply, from: patch.from, version: patch.version }); for (const listener of this.listeners) listener({ ...patch, value, apply }); return true; }
  define(pattern: string, config: StateSyncConfig) { this.rules.push([pattern, config]); }
  config(path: string) { return this.rules.find(([pattern]) => matches(pattern, path))?.[1]; }
  onChange(listener: (patch: StatePatch) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot(value: unknown, path = '') { if (path) { this.patch({ path, value, from: 'host' }); return; } if (!value || typeof value !== 'object') return; this.data = structuredClone(value) as Record<string, unknown>; this.adapter?.set('', value, { remoteApply: 'replace', from: 'host' }); for (const listener of this.listeners) listener({ path: '', value, from: 'host', apply: 'replace' }); }
  clear() { this.listeners.clear(); this.rules = []; this.data = {}; this.versions.clear(); }
}

export class ActionRegistryImpl implements ActionRegistry {
  private definitions = new Map<string, { config: ActionConfig; handler: ActionHandler<unknown> }>(); private listeners = new Set<(action: GameAction) => void>(); private seen = new Set<string>(); private deferred = new Set<string>(); private seq = 0;
  constructor(private context: () => Parameters<ActionHandler<unknown>>[0], private now: () => number) {}
  define<T>(type: string, config: ActionConfig, handler: ActionHandler<T>) { if (this.definitions.has(type)) throw new Error(`Action already defined: ${type}`); this.definitions.set(type, { config, handler: handler as ActionHandler<unknown> }); }
  dispatch<T>(type: string, payload: T, meta: Partial<GameAction<T>> = {}) { const definition = this.definitions.get(type); if (!definition) throw new Error(`Unknown action: ${type}`); if (!serializable(payload)) throw new Error(`Action payload is not serializable: ${type}`); const ctx = this.context(); const seq = meta.seq ?? ++this.seq; const action: GameAction<T> = { id: meta.id ?? `${ctx.playerId}:${seq}`, type, payload, from: meta.from ?? ctx.playerId, seq, origin: meta.origin ?? 'local', createdAt: meta.createdAt ?? this.now(), ...(meta.roomId ? { roomId: meta.roomId } : {}) }; if (this.seen.has(action.id)) { if (action.origin === 'host' && this.deferred.delete(action.id)) definition.handler(ctx, payload, action); return action; } this.seen.add(action.id); const defer = definition.config.sync.mode === 'hostAuthoritative' && action.origin === 'local'; if (defer) this.deferred.add(action.id); else definition.handler(ctx, payload, action); for (const listener of this.listeners) listener(action); return action; }
  onAfterDispatch(listener: (action: GameAction) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getPolicy(type: string) { return this.definitions.get(type)?.config.sync; } clear() { this.definitions.clear(); this.listeners.clear(); this.seen.clear(); this.deferred.clear(); }
}

class Runtime implements GameRuntime {
  readonly world = new WorldImpl(); readonly events = new EventBusImpl(); readonly state: StateStoreImpl; readonly actions: ActionRegistryImpl; private mutableSystems: GameSystem[] = []; private mutablePlugins: GamePlugin[] = []; private cleanups: Array<() => void> = []; private dead = false;
  constructor(readonly playerId: string, readonly isHost: boolean, adapter?: StateAdapter, now: () => number = Date.now) { this.state = new StateStoreImpl(adapter); this.actions = new ActionRegistryImpl(() => ({ game: this, world: this.world, state: this.state, events: this.events, playerId, isHost }), now); }
  get systems() { return this.mutableSystems; } get plugins() { return this.mutablePlugins; }
  action<T>(type: string, payload?: T) { return this.actions.dispatch(type, (payload === undefined ? null : payload) as T); }
  update(dt: number) { if (!this.dead) for (const system of this.mutableSystems) system.update(this, dt); }
  addSystem(system: GameSystem) { this.mutableSystems.push(system); }
  use(plugin: GamePlugin) { if (this.mutablePlugins.some((item) => item.name === plugin.name)) throw new Error(`Plugin already installed: ${plugin.name}`); this.mutablePlugins.push(plugin); const cleanup = plugin.install(this); if (cleanup) this.cleanups.push(cleanup); }
  dispose() { if (this.dead) return; this.dead = true; for (const cleanup of this.cleanups.splice(0).reverse()) cleanup(); this.actions.clear(); this.state.clear(); this.events.clear(); this.mutableSystems = []; this.mutablePlugins = []; }
}
export interface RuntimeOptions { playerId: string; isHost?: boolean; stateAdapter?: StateAdapter; now?: () => number; players?: FlowPlayer[]; host?: FlowPlayer }
export function createGameRuntime(options: RuntimeOptions): GameRuntime;
export function createGameRuntime<State>(definition: GameDefinition<State>, options: RuntimeOptions & { role: 'client' }): GameRuntime;
export function createGameRuntime<State>(definitionOrOptions: GameDefinition<State> | RuntimeOptions, maybeOptions?: RuntimeOptions & { role: 'client' }): GameRuntime {
  if (!('actions' in definitionOrOptions)) { const options = definitionOrOptions; return new Runtime(options.playerId, options.isHost ?? false, options.stateAdapter, options.now); }
  const definition = definitionOrOptions, options = maybeOptions!; const runtime = new Runtime(options.playerId, options.isHost ?? false, options.stateAdapter, options.now);
  runtime.state.snapshot(definition.initialState());
  for (const [pattern, config] of Object.entries(definition.state ?? {})) runtime.state.define(pattern, config);
  const player = (): FlowPlayer => options.players?.find((item) => item.id === options.playerId) ?? { id: options.playerId, name: options.playerId, role: options.isHost ? 'host' : 'player' };
  const context = (action?: GameAction): FlowReducerContext<State> => ({ state: runtime.state.get<State>('')!, role: 'client', actor: options.players?.find((item) => item.id === action?.from) ?? (action?.from && action.from !== options.playerId ? { id: action.from, name: action.from, role: 'player' } : player()), players: options.players ?? [player()], host: options.host ?? player(), now: options.now ?? Date.now, random: Math.random,
    timers: { dispatch() {}, clear() {} }, emit: (type, payload) => runtime.events.emit(type, payload), dispatch: (type, payload) => { runtime.action(type, payload); }, kick() {}, });
  for (const [type, action] of Object.entries(definition.actions)) runtime.actions.define(type, { sync: action.sync }, (_, payload, envelope) => action.reduce(context(envelope), payload, envelope));
  for (const system of definition.systems ?? []) if (system.runOn !== 'authority') runtime.addSystem({ update: (_, dt) => system.update(context(), dt) });
  return runtime;
}
