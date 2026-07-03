export const WORLD_WIDTH = 900;
export const VIEW_HEIGHT = 1600;
export const CHUNK_HEIGHT = 1600;
export const CHUNKS_PER_REGION = 7;
export const PLAYER_RADIUS = 34;

export type Phase = 'lobby' | 'running' | 'boss' | 'gameover';
export type RegionKind = 'normal' | 'cooperative' | 'boss';

export type Platform = { id: string; x: number; y: number; width: number; kind: 'normal' | 'relay-trigger' | 'relay-bridge' | 'gate' | 'boss-exit' };
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
  direction: -1 | 0 | 1;
  arrivedGate: number | null;
  kills: number;
  deaths: number;
  shots: number;
  tilt: boolean;
  buffs: string[];
};

export type BossState = { gate: number; id: string; name: string; hp: number; maxHp: number } | null;

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
};

declare global { const parti: PartiApi; }
