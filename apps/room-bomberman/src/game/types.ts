export type Phase = 'lobby' | 'playing' | 'overtime' | 'finished';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type PowerupType = 'flame' | 'capacity' | 'speed' | 'kick' | 'remote';
export type Direction = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

export interface PlayerState {
  id: string;
  name: string;
  bot: boolean;
  difficulty?: Difficulty;
  ready: boolean;
  connected: boolean;
  waiting: boolean;
  x: number;
  y: number;
  input: Direction;
  alive: boolean;
  score: number;
  deaths: number;
  flame: number;
  capacity: number;
  speed: number;
  kick: boolean;
  remote: boolean;
  respawnAt: number;
  invulnerableUntil: number;
  nextMoveAt: number;
  color: number;
  spawnIndex: number;
}

export interface BombState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  flame: number;
  explodeAt: number;
  remote: boolean;
  motion: Direction;
  nextMoveAt: number;
}

export interface FlameState { id: string; ownerId: string; cells: Array<{ x: number; y: number }>; expiresAt: number }
export interface PowerupState { id: string; type: PowerupType; x: number; y: number }

export interface GameState {
  schema: 'bomberman-v1';
  phase: Phase;
  hostId: string | null;
  mapId: string;
  players: Record<string, PlayerState>;
  bombs: BombState[];
  flames: FlameState[];
  powerups: PowerupState[];
  destroyed: string[];
  startedAt: number;
  endsAt: number;
  overtimeEndsAt: number;
  overtimeLeaders: string[];
  winners: string[];
  tick: number;
}
