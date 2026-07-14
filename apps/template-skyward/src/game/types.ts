export const WORLD_WIDTH = 900;
export const VIEW_HEIGHT = 1600;
export const CHUNK_HEIGHT = 1600;
export const CHUNKS_PER_REGION = 7;
export const PLAYER_RADIUS = 34;

export type Phase = 'lobby' | 'running' | 'boss' | 'gameover';
export type RegionKind = 'normal' | 'cooperative' | 'boss';

export type PlatformBehavior =
  | { type: 'move'; axis: 'x' | 'y'; range: number; periodMs: number; phase: number }
  | { type: 'blink'; periodMs: number; activeMs: number; phase: number }
  | { type: 'crumble'; delayMs: number };
export type Platform = {
  id: string;
  x: number;
  y: number;
  width: number;
  kind: 'normal' | 'relay-trigger' | 'relay-bridge' | 'boss-reveal';
  behavior?: PlatformBehavior;
  hazard?: 'spikes';
  optional?: boolean;
};
export type HazardZone = { id: string; kind: 'wind' | 'lightning' | 'trail'; x: number; y: number; width: number; height: number; strength?: number; activeFrom?: number; activeUntil?: number };
export type EnemySpawn = { id: string; platformId: string; x: number; y: number; kind: 'drifter' | 'spike' };
export type PickupSpawn = { id: string; platformId: string; x: number; y: number; kind: 'rapid' | 'spread' | 'power' | 'team-shield' };
export type Connector = { minX: number; maxX: number; minY: number; maxY: number; wrap: true };

export type TerrainChunk = {
  index: number;
  moduleId: string;
  biomeId: string;
  regionKind: RegionKind;
  baseY: number;
  height: number;
  entry: Connector;
  exit: Connector;
  platforms: Platform[];
  route: string[];
  enemies: EnemySpawn[];
  pickups: PickupSpawn[];
  tags: string[];
  hazards: HazardZone[];
  bossCeilingY?: number;
};

export type PublicPlayer = {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  alive: boolean;
  respawnAt: number | null;
  invulnerableUntil: number;
  x: number;
  y: number;
  vy: number;
  positionEpoch: number;
  cameraBottom: number;
  direction: number;
  arrivedGate: number | null;
  kills: number;
  deaths: number;
  shots: number;
  tilt: boolean;
  buffs: string[];
};

export type BossKind = 'storm-eye' | 'sky-whale' | 'thunder-core';
export type BossAttackKind = 'aimed' | 'fan' | 'dive' | 'trail' | 'lightning' | 'summon';
export type BossAttack = { id: string; kind: BossAttackKind; startedAt: number; endsAt: number; targetX: number; targetY: number; angle?: number };
export type BossState = {
  gate: number;
  id: BossKind;
  name: string;
  tier: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  phase: number;
  attackSequence: number;
  attacks: BossAttack[];
  nextAttackAt: number;
  vulnerableFrom: number;
} | null;

export type GameState = {
  phase: Phase;
  hostId: string | null;
  seed: number;
  startedPlayers: string[];
  players: Record<string, PublicPlayer>;
  teamVoidY: number;
  highestY: number;
  bossCount: number;
  nextGate: number;
  boss: BossState;
  defeatedEnemies: string[];
  claimedPickups: string[];
  teamBuffs: string[];
  activeRelays: string[];
  bestRun: { height: number; bosses: number };
  message: string;
  startedAt: number | null;
};

export type PartiApi = {
  playerId: string | null;
  getState(): unknown;
  onState(handler: (state: unknown) => void): () => void;
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  leave(): void;
  log(...args: unknown[]): void;
  orientation?: {
    getStatus(): 'unsupported' | 'needs-permission' | 'requesting' | 'active' | 'denied' | 'blocked-by-policy' | 'no-data';
    requestPermission(): Promise<'unsupported' | 'needs-permission' | 'requesting' | 'active' | 'denied' | 'blocked-by-policy' | 'no-data'>;
    onStatus(handler: (status: string) => void): () => void;
    onData(handler: (data: { beta: number | null; gamma: number | null; screenAngle: number; timestamp: number }) => void): () => void;
  };
};

declare global { const parti: PartiApi; }
