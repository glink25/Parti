export const SCHEMA_VERSION = 2;
export const WORLD_WIDTH = 900;
export const VIEW_HEIGHT = 1600;
export const CHUNK_HEIGHT = 1600;
export const PLAYER_RADIUS = 32;
export const BOSS_INTERVAL = 10;
export const BOSS_TRIGGER_OFFSET = 700;
export const BOSS_SPAWN_Y_MIN = 1300;
export const BOSS_SPAWN_Y_MAX = 1450;

export type Random = { float(): number; int(min: number, max: number): number; pick<T>(items: readonly T[]): T };
export type PlatformKind = 'normal' | 'moving' | 'fragile' | 'recovering' | 'spikes' | 'trigger' | 'bridge' | 'spring' | 'boss-exit';
export type EnemyKind = 'sentry' | 'floater' | 'patroller' | 'charger' | 'occupier' | 'storm-warden' | 'sky-behemoth' | 'mechanical-core';
export type BossKind = Extract<EnemyKind, 'storm-warden' | 'sky-behemoth' | 'mechanical-core'>;
export type PickupKind = 'shield' | 'rapid' | 'power' | 'spread' | 'pierce' | 'rocket' | 'propeller' | 'super-jump' | 'slow-fall';
export type EffectId = PickupKind;

export type MovementDefinition = {
  axis: 'x' | 'y' | 'path'; range: number; periodMs: number; phase: number;
  delayMs?: number; pauseMs?: number; path?: readonly { x: number; y: number }[];
};
export type PlatformConfig = {
  movement?: MovementDefinition;
  breakDelayMs?: number; recoverMs?: number; warningMs?: number;
  spike?: { start: number; end: number; periodMs: number; warningMs: number; activeMs: number; phase: number };
  trigger?: { mode: 'permanent' | 'timed' | 'sequence'; durationMs: number; requiredHits: number; resetMs: number; outputs: string[] };
  spring?: { start: number; end: number; velocity: number };
};
export type Platform = { id: string; kind: PlatformKind; x: number; y: number; width: number; optional: boolean; rewardMultiplier?: number; config?: PlatformConfig };

export type EnemyController =
  | { kind: 'stationary' }
  | { kind: 'patrol' | 'float'; axis: 'x' | 'y'; range: number; periodMs: number; phase: number }
  | { kind: 'charge'; range: number; periodMs: number; warningMs: number; phase: number }
  | { kind: 'occupy'; platformId: string; periodMs: number; openMs: number; phase: number };
export type AttackDefinition = { id: string; kind: 'shot' | 'charge' | 'lightning' | 'lock-zone' | 'platform-hazard' | 'summon' | 'slam' | 'tilt-zone' | 'laser' | 'platform-toggle'; warningMs: number; activeMs: number; cooldownMs: number; radius?: number; direction?: 'up' | 'down' | 'left' | 'right'; moving?: boolean };
export type DropEntry = { pickup: PickupKind; weight: number };
export type Enemy = { id: string; kind: EnemyKind; x: number; y: number; hp: number; radius: number; boss?: boolean; stompable: boolean; controller: EnemyController; attacks: AttackDefinition[]; drops: DropEntry[]; anchorId?: string };
export type Pickup = { id: string; kind: PickupKind; x: number; y: number; durationMs: number; sourceId?: string };

export type WeightedId<T extends string> = { id: T; weight: number };
export type BiomeContentPool = { platforms: WeightedId<PlatformKind>[]; enemies: WeightedId<EnemyKind>[]; pickups: WeightedId<PickupKind>[]; bosses: WeightedId<BossKind>[]; environment: 'calm' | 'updraft' | 'storm' };
export type BiomeDefinition = { id: string; name: string; background: string; platform: string; accent: string; content: BiomeContentPool };
export type ChunkRecipe = 'normal' | 'danger' | 'reward' | 'mechanism' | 'boss-buffer' | 'boss';
export type DifficultyAxes = { sparsity: number; hazardRate: number; enemyDensity: number; enemyStrength: number; bossLevel: number };
export type Chunk = { index: number; biomeId: string; baseY: number; difficulty: number; difficultyAxes: DifficultyAxes; recipe: ChunkRecipe; boss: boolean; entryX: number; exitX: number; route: string[]; platforms: Platform[]; enemies: Enemy[]; pickups: Pickup[] };
export type GenerationContext = { seed: number; chunkIndex: number; players: number; difficulty: number; difficultyAxes: DifficultyAxes; biome: BiomeDefinition; rng(channel: string): Random };
export type RuntimeContext = GenerationContext & { startedAt: number; now: number };

export type RuntimeEffect =
  | { kind: 'entity-state'; entityId: string; state: DynamicEntityState }
  | { kind: 'apply-effect'; effect: ActiveEffect }
  | { kind: 'remove-effect'; effectId: EffectId }
  | { kind: 'damage'; targetId: string; amount: number }
  | { kind: 'spawn-enemy'; enemy: Enemy }
  | { kind: 'spawn-hazard'; hazard: HazardState }
  | { kind: 'stat'; stat: 'kills' | 'noDamageHeight'; amount: number }
  | { kind: 'message'; text: string };
export type ContactResult = { bounceVelocity?: number; damageReason?: string; effects: RuntimeEffect[] };
export type RenderDescription = { color: string; label: string; warning?: boolean; hidden?: boolean; spikeRange?: [number, number] };

export type PlatformStrategy = { id: PlatformKind; version: number; safe: boolean; weight: number; generate(platform: Platform, context: GenerationContext, index: number): Platform; contact(platform: Platform, context: RuntimeContext, state?: DynamicEntityState): ContactResult; transition(platform: Platform, context: RuntimeContext, state?: DynamicEntityState): DynamicEntityState | null; render(platform: Platform, context: RuntimeContext, state?: DynamicEntityState): RenderDescription };
export type EnemyStrategy = { id: EnemyKind; version: number; weight: number; boss?: boolean; create(context: GenerationContext, index: number, anchor: Platform | null): Enemy; position(enemy: Enemy, context: RuntimeContext): { x: number; y: number }; contact(enemy: Enemy, context: RuntimeContext): ContactResult; hit(enemy: Enemy, damage: number, stomp: boolean): RuntimeEffect[]; attack(enemy: Enemy, context: RuntimeContext, sequence: number): AttackDefinition | null; death(enemy: Enemy, context: RuntimeContext): RuntimeEffect[] };
export type PickupStrategy = { id: PickupKind; version: number; weight: number; durationMs: number; create(context: GenerationContext, index: number, anchor: Platform): Pickup; claim(pickup: Pickup, context: RuntimeContext): RuntimeEffect[]; refresh(current: ActiveEffect, pickup: Pickup, now: number): ActiveEffect; end(effect: ActiveEffect): RuntimeEffect[]; hud(effect: ActiveEffect, now: number): string };
export type BossPhaseDefinition = { id: string; minHpRatio: number; warningScale: number; cooldownScale: number; attacks: WeightedId<AttackDefinition['kind']>[]; weak?: boolean };
export type BossStrategy = EnemyStrategy & { boss: true; phases: BossPhaseDefinition[]; arenaPlatforms(context: GenerationContext): Platform[]; selectAttack(enemy: Enemy, context: RuntimeContext, phase: BossPhaseDefinition, sequence: number, target?: { x: number; y: number }): BossAttack; summons(enemy: Enemy, context: RuntimeContext, sequence: number): Enemy[]; victory(enemy: Enemy): RuntimeEffect[] };
export type EncounterStrategy = { id: string; version: number; populate(context: GenerationContext, route: Platform[], optional: Platform[]): { enemies: Enemy[]; pickups: Pickup[] } };

export type ActiveEffect = { id: EffectId; startedAt: number; endsAt: number | null; stacks: number; sourceId: string; phase?: 'starting' | 'active' | 'ending' | 'grounding' };
export type PlatformEntityState = { kind: 'platform'; phase: 'warning' | 'hidden' | 'restoring' | 'active'; changedAt: number; until: number | null };
export type TriggerEntityState = { kind: 'trigger'; count: number; activatedAt: number; until: number | null };
export type EnemyEntityState = { kind: 'enemy'; hp: number; defeated: boolean; changedAt: number };
export type HazardState = { kind: 'hazard'; hazardKind: AttackDefinition['kind']; x: number; y: number; radius: number; activeAt: number; endsAt: number; platformId?: string; direction?: AttackDefinition['direction'] };
export type SummonEntityState = { kind: 'summon'; enemy: Enemy; hp: number; defeated: boolean; changedAt: number };
export type PickupEntityState = { kind: 'pickup'; pickup?: Pickup; claimedBy?: string; claimedAt?: number };
export type DynamicEntityState = PlatformEntityState | TriggerEntityState | EnemyEntityState | HazardState | SummonEntityState | PickupEntityState;

export type BossAttack = { id: string; kind: AttackDefinition['kind']; x: number; y: number; radius: number; startedAt: number; activeAt: number; endsAt: number; platformId?: string; direction?: AttackDefinition['direction'] };
export type BossEncounter = { enemyId: string; bossId: BossKind; ordinal: number; chunkIndex: number; hp: number; maxHp: number; phaseId: string; startedAt: number; nextAttackAt: number; sequence: number; attacks: BossAttack[]; summons: Enemy[] } | null;
export type PublicPlayer = { id: string; name: string; ready: boolean; connected: boolean; alive: boolean; respawnAt: number | null; invulnerableUntil: number; x: number; y: number; vy: number; cameraBottom: number; direction: number; positionEpoch: number; kills: number; deaths: number; shots: number; killStreak: number; noDamageHeight: number; tilt: boolean; lastHitSequence: number; lastOutcomeSequence: number; effects: Partial<Record<EffectId, ActiveEffect>> };
export type Phase = 'lobby' | 'running' | 'gameover';
export type GameState = { schemaVersion: number; contentFingerprint: string; phase: Phase; hostId: string | null; seed: number; startedAt: number | null; startedPlayers: string[]; players: Record<string, PublicPlayer>; teamVoidY: number; highestY: number; completedBossCount: number; entities: Record<string, DynamicEntityState>; boss: BossEncounter; bestRun: { height: number; bosses: number; kills: number; noDamageHeight: number }; message: string };
export type PartiApi = { playerId: string | null; getState(): unknown; onState(handler: (state: unknown) => void): () => void; onEvent(event: string, handler: (payload: unknown) => void): () => void; action(action: string, payload?: unknown): Promise<{ ok: true }>; ready(): void; leave(): void; orientation?: { getStatus(): string; requestPermission(): Promise<string>; onStatus(handler: (status: string) => void): () => void; onData(handler: (data: { beta: number | null; gamma: number | null; screenAngle: number; timestamp: number }) => void): () => void } };
declare global { const parti: PartiApi; }
