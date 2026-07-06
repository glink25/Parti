export type ActionOrigin = 'local' | 'remote' | 'host' | 'replay';
export type ActionSyncMode = 'localOnly' | 'optimisticBroadcast' | 'hostRelay' | 'hostAuthoritative';
export type StateSyncMode = 'ownerInterval' | 'hostInterval' | 'manualSnapshot' | 'presence';
export type StateApplyMode = 'replace' | 'smooth' | 'merge' | 'ignoreIfLocalOwner';

export interface GameAction<T = unknown> {
  id: string; type: string; payload: T; from: string; seq: number;
  origin: ActionOrigin; createdAt: number; roomId?: string;
}
export interface ActionConfig { sync: { mode: ActionSyncMode; reliable?: boolean; local?: 'immediate' | 'deferred' } }
export interface StateSyncConfig { sync: { mode: StateSyncMode; intervalMs?: number; remoteApply?: StateApplyMode } }
export interface StatePatch { path: string; value: unknown; version?: number; from?: string; apply?: StateApplyMode }
export interface StateApplyOptions { remoteApply?: StateApplyMode; from?: string; version?: number }
export interface StateAdapter {
  get(path: string): unknown;
  set(path: string, value: unknown, options?: StateApplyOptions): void;
}
export interface EntityCreateOptions { id?: string; type?: string; components?: Record<string, unknown> }
export type EntityId = string;

export interface GameSystem { update(game: GameRuntime, dt: number): void }
export interface GamePlugin { name: string; install(game: GameRuntime): void | (() => void) }
export interface ActionContext { game: GameRuntime; world: World; state: StateStore; events: EventBus; playerId: string; isHost: boolean }
export type ActionHandler<T> = (ctx: ActionContext, payload: T, action: GameAction<T>) => void;

export interface World {
  spawn(options: EntityCreateOptions): EntityId; destroy(id: EntityId): void; has(id: EntityId): boolean;
  getComponent<T>(id: EntityId, name: string): T | undefined;
  setComponent<T>(id: EntityId, name: string, value: T): void;
  patchComponent<T extends object>(id: EntityId, name: string, patch: Partial<T>): void;
  entitiesWith(...components: string[]): EntityId[];
}
export interface EventBus {
  emit<T>(type: string, payload: T): void;
  on<T>(type: string, handler: (payload: T) => void): () => void;
  clear(): void;
}
export interface StateStore {
  get<T>(path: string): T | undefined; set<T>(path: string, value: T): void; patch(patch: StatePatch): boolean;
  define(pattern: string, config: StateSyncConfig): void; config(path: string): StateSyncConfig | undefined;
  onChange(listener: (patch: StatePatch) => void): () => void; snapshot(value: unknown, path?: string): void; clear(): void;
}
export interface ActionRegistry {
  define<T>(type: string, config: ActionConfig, handler: ActionHandler<T>): void;
  dispatch<T>(type: string, payload: T, meta?: Partial<GameAction<T>>): GameAction<T>;
  onAfterDispatch(listener: (action: GameAction) => void): () => void;
  getPolicy(type: string): ActionConfig['sync'] | undefined; clear(): void;
}
export interface GameRuntime {
  readonly playerId: string; readonly isHost: boolean; readonly world: World; readonly actions: ActionRegistry;
  readonly state: StateStore; readonly events: EventBus; readonly systems: readonly GameSystem[]; readonly plugins: readonly GamePlugin[];
  action<T>(type: string, payload?: T): GameAction<T>; update(dt: number): void; use(plugin: GamePlugin): void;
  addSystem(system: GameSystem): void; dispose(): void;
}

export type RuntimeRole = 'client' | 'authority';
export interface FlowPlayer { id: string; name: string; role: 'host' | 'player' | 'spectator' }
export type ValidationResult<T> = { ok: true; payload: T } | { ok: false; reason: string };
export const accept = <T>(payload: T): ValidationResult<T> => ({ ok: true, payload });
export const reject = (reason: string): ValidationResult<never> => ({ ok: false, reason });
export interface FlowTimerService { dispatch(name: string, delayMs: number, action: string, payload?: unknown, actorId?: string): void; clear(name: string): void }
export interface FlowReducerContext<State> {
  state: State; role: RuntimeRole; actor: FlowPlayer; players: FlowPlayer[]; host: FlowPlayer;
  now(): number; random(): number; timers: FlowTimerService;
  emit<T>(type: string, payload: T): void; dispatch<T>(type: string, payload?: T, actorId?: string): void; kick(playerId: string, reason?: string): void;
}
export interface FlowActionDefinition<State, Payload = unknown> {
  sync: ActionConfig['sync'];
  validate?(ctx: FlowReducerContext<State>, payload: Payload): ValidationResult<Payload>;
  reduce(ctx: FlowReducerContext<State>, payload: Payload, action: GameAction<Payload>): void;
}
export interface FlowSystemDefinition<State> { runOn: RuntimeRole | 'both'; intervalMs?: number; update(ctx: FlowReducerContext<State>, dt: number): void }
export interface FlowLifecycle<State> {
  create?(ctx: FlowReducerContext<State>): void; restore?(ctx: FlowReducerContext<State>): void;
  join?(ctx: FlowReducerContext<State>, player: FlowPlayer): void; reconnect?(ctx: FlowReducerContext<State>, player: FlowPlayer): void;
  leave?(ctx: FlowReducerContext<State>, player: FlowPlayer): void; ready?(ctx: FlowReducerContext<State>, player: FlowPlayer): void;
}
export interface GameDefinition<State> {
  meta?: { name?: string; minPlayers?: number; maxPlayers?: number }; initialState(): State;
  actions: Record<string, FlowActionDefinition<State, any>>; state?: Record<string, StateSyncConfig & { write?: 'owner' }>;
  systems?: FlowSystemDefinition<State>[]; lifecycle?: FlowLifecycle<State>;
}
export function defineGame<State>(definition: GameDefinition<State>): GameDefinition<State> { return definition; }
