export const WORLD_WIDTH = 900;
export const VIEW_HEIGHT = 1600;
export const CHUNK_HEIGHT = 1600;
export const PLAYER_RADIUS = 32;
export const BOSS_INTERVAL = 6;

export type Random = { float(): number; int(min: number, max: number): number; pick<T>(items: readonly T[]): T };
export type EntityKind = 'platform' | 'enemy' | 'pickup';
export type PlatformKind = 'normal' | 'moving' | 'fragile' | 'recovering' | 'spikes' | 'trigger' | 'bridge' | 'boss-exit';
export type EnemyKind = 'sentry' | 'floater' | 'patroller' | 'storm-warden';
export type PickupKind = 'shield' | 'rapid' | 'power' | 'rocket' | 'propeller' | 'super-jump' | 'slow-fall';

export type Platform = {
  id: string; kind: PlatformKind; x: number; y: number; width: number; optional: boolean;
  movement?: { range: number; periodMs: number; phase: number };
  recoverMs?: number; linkedId?: string;
};
export type Enemy = {
  id: string; kind: EnemyKind; x: number; y: number; hp: number; radius: number; boss?: boolean;
  movement?: { range: number; periodMs: number; phase: number };
};
export type Pickup = { id: string; kind: PickupKind; x: number; y: number; durationMs: number };
export type BiomeDefinition = { id: string; name: string; background: string; platform: string; accent: string };
export type Chunk = {
  index: number; biomeId: string; baseY: number; difficulty: number; boss: boolean;
  entryX: number; exitX: number; route: string[]; platforms: Platform[]; enemies: Enemy[]; pickups: Pickup[];
};
export type GenerationContext = { seed: number; chunkIndex: number; players: number; difficulty: number; biome: BiomeDefinition; rng(channel: string): Random };
export type PlatformStrategy = { id: PlatformKind; safe: boolean; weight: number; apply(platform: Platform, context: GenerationContext, index: number): Platform };
export type EnemyStrategy = { id: EnemyKind; weight: number; boss?: boolean; create(context: GenerationContext, index: number, anchor: Platform | null): Enemy };
export type PickupStrategy = { id: PickupKind; weight: number; durationMs: number; create(context: GenerationContext, index: number, anchor: Platform): Pickup };
export type BossStrategy = EnemyStrategy & { boss: true; arenaPlatforms(context: GenerationContext): Platform[] };
export type EncounterStrategy = { id: string; populate(context: GenerationContext, route: Platform[], optional: Platform[]): { enemies: Enemy[]; pickups: Pickup[] } };

export type PublicPlayer = {
  id: string; name: string; ready: boolean; connected: boolean; alive: boolean; respawnAt: number | null; invulnerableUntil: number;
  x: number; y: number; vy: number; cameraBottom: number; direction: number; positionEpoch: number; kills: number; deaths: number; shots: number; tilt: boolean;
  lastHitSequence: number; lastOutcomeSequence: number;
  buffs: Partial<Record<PickupKind, number>>;
};
export type DynamicEntityState = { disabledUntil?: number; hp?: number; activatedUntil?: number };
export type BossEncounter = { enemyId: string; chunkIndex: number; hp: number; maxHp: number; startedAt: number; nextAttackAt: number; sequence: number; attacks: BossAttack[]; summons: Enemy[] } | null;
export type BossAttack = { id: string; kind: 'lightning' | 'lock-zone' | 'platform-hazard' | 'summon'; x: number; y: number; startedAt: number; activeAt: number; endsAt: number };
export type Phase = 'lobby' | 'running' | 'gameover';
export type GameState = {
  phase: Phase; hostId: string | null; seed: number; startedAt: number | null; startedPlayers: string[]; players: Record<string, PublicPlayer>;
  teamVoidY: number; highestY: number; bossCount: number; defeatedEnemies: string[]; claimedPickups: string[];
  entities: Record<string, DynamicEntityState>; boss: BossEncounter; bestRun: { height: number; bosses: number }; message: string;
};
export type PartiApi = { playerId: string | null; getState(): unknown; onState(handler: (state: unknown) => void): () => void; onEvent(event: string, handler: (payload: unknown) => void): () => void; action(action: string, payload?: unknown): Promise<{ ok: true }>; ready(): void; leave(): void; orientation?: { getStatus(): string; requestPermission(): Promise<string>; onStatus(handler: (status: string) => void): () => void; onData(handler: (data: { beta: number | null; gamma: number | null; screenAngle: number; timestamp: number }) => void): () => void } };
declare global { const parti: PartiApi; }
