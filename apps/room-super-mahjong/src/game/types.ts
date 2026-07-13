import type { Meld, RulesConfig, Tile, TileKind } from '../worker/types';

export type Phase = 'lobby' | 'dealing' | 'playing' | 'reaction' | 'settlement' | 'matchEnd';
export type SeatState = {
  id: string; name: string; seat: number; bot: boolean; connected: boolean;
  ready: boolean; score: number; dealer: boolean; handCount: number;
  melds: Meld[]; discards: Tile[];
};
export type PublicReaction = { discarderSeat: number; tile: Tile; awaitingSeats: number[] };
export type RoundResult = {
  draw: boolean; winners: Array<{ seat: number; sourceSeat: number | null; points: number; fan: number; patterns: string[] }>;
  deltas: number[]; message: string;
};
export type GameState = {
  phase: Phase; rules: RulesConfig; seats: Array<SeatState | null>; hostId: string | null;
  roundIndex: number; dealerSeat: number; currentSeat: number | null; wallCount: number;
  lastDiscard: { seat: number; tile: Tile } | null; reaction: PublicReaction | null;
  result: RoundResult | null; message: string;
};
export type PrivateState = {
  hand: Tile[]; canWin: boolean; concealedGangKinds: TileKind[]; addedGangKinds: TileKind[];
  reactionOptions: Array<'win'|'gang'|'peng'|'chi'>; chiOptions: TileKind[][];
};
export type PartiApi = {
  playerId: string | null;
  getState(): unknown;
  onState(handler: (state: unknown) => void): () => void;
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void; leave(): void; log(...args: unknown[]): void;
};
declare global { const parti: PartiApi; }
