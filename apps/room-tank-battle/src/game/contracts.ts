export type Phase = 'lobby' | 'running' | 'finished';
export type GameMode = 'freeForAll' | 'team2v2';
export type Team = 'red' | 'blue';
export type Direction = 'up' | 'down' | 'left' | 'right' | 'none';
export type Tile = 'ground' | 'brick' | 'steel' | 'water' | 'forest' | 'ice';
export type PowerUpKind = 'armor' | 'shield' | 'bomb' | 'fortify' | 'rapidFire';

export interface Point { x: number; y: number }
export type Facing = Exclude<Direction, 'none'>;

export interface BasePlacement {
  position: Point;
  facing: Facing;
  protectionTiles: number[];
}

export interface FfaLayout {
  spawns: Point[];
  bases: BasePlacement[];
}

export interface MapDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: Tile[];
  ffaLayouts: Record<2 | 3 | 4, FfaLayout>;
  teamSpawns: { red: Point[]; blue: Point[] };
  teamBases: { red: BasePlacement; blue: BasePlacement };
  aiSpawns: Point[];
  powerUpSpawns: Point[];
  center: Point;
}

export interface PlayerState {
  id: string;
  name: string;
  ready: boolean;
  team: Team;
  connected: boolean;
  alive: boolean;
  eliminated: boolean;
  x: number;
  y: number;
  direction: Direction;
  input: Direction;
  kills: number;
  aiKills: number;
  shieldUntil: number;
  rapidFireUntil: number;
  armor: number;
  nextFireAt: number;
  respawnAt: number | null;
}

export interface BaseState {
  id: string;
  ownerId?: string;
  team?: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  fortifiedUntil: number;
  protectionTiles: number[];
}

export interface BulletState extends Point {
  id: string;
  ownerId: string;
  ownerKind: 'player' | 'ai';
  team?: Team;
  direction: Exclude<Direction, 'none'>;
  speed: number;
  steelPiercing: boolean;
}

export interface AiState extends Point {
  id: string;
  hp: number;
  direction: Exclude<Direction, 'none'>;
  nextDecisionAt: number;
  nextFireAt: number;
  behavior: 'patrol' | 'chase' | 'unstuck';
  targetPlayerId: string | null;
  path: Point[];
  lastProgressX: number;
  lastProgressY: number;
  lastProgressAt: number;
  stuckSince: number | null;
  bulletId: string | null;
}

export interface PowerUpState extends Point {
  id: string;
  kind: PowerUpKind;
  expiresAt: number;
}

export interface GameConfig { mode: GameMode; mapId: string }

export interface GameResult {
  winnerId?: string;
  winnerTeam?: Team;
  draw: boolean;
  reason: 'elimination' | 'timeout';
}

export interface GameState {
  schema: 'tank-battle-v1';
  phase: Phase;
  config: GameConfig;
  hostId: string | null;
  players: Record<string, PlayerState>;
  bases: Record<string, BaseState>;
  bullets: Record<string, BulletState>;
  ai: Record<string, AiState>;
  powerUps: Record<string, PowerUpState>;
  destroyedTiles: number[];
  startedAt: number | null;
  deadlineAt: number | null;
  lastTickAt: number | null;
  nextAiSpawnAt: number;
  nextPowerUpAt: number;
  sequence: number;
  result: GameResult | null;
}

export const TILE_SIZE = 1;
export const TANK_SIZE = 0.78;
export const PLAYER_SPEED = 3.2;
export const AI_SPEED = 1.75;
export const BULLET_SPEED = 8;
export const MATCH_DURATION_MS = 12 * 60 * 1000;
export const RESPAWN_MS = 2000;
export const MAX_AI = 3;
export const MAX_BULLETS = 28;
export const MAX_POWER_UPS = 3;
