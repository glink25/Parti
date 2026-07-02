export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds' | 'joker';

export type Card = {
  id: string;
  suit: Suit;
  rank: number;
  label: string;
};

export type PlayerState = {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  score: number;
  connected: boolean;
  role: 'landlord' | 'farmer' | null;
};

export type PlayType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple-single'
  | 'triple-pair'
  | 'straight'
  | 'pair-straight'
  | 'airplane'
  | 'airplane-singles'
  | 'airplane-pairs'
  | 'four-two-singles'
  | 'four-two-pairs'
  | 'bomb'
  | 'rocket';

export type PlayAnalysis = {
  type: PlayType;
  rank: number;
  length: number;
  chainLength?: number;
  label: string;
};

export type PlayRecord = {
  playerId: string;
  cards: Card[];
  analysis: PlayAnalysis;
};

export type GameState = {
  phase: 'waiting' | 'ready' | 'bidding' | 'playing' | 'settlement';
  players: Record<string, PlayerState>;
  seats: Array<string | null>;
  dealer: string | null;
  landlordCardsVisible: Card[];
  currentPlayerId: string | null;
  bidState: {
    currentPlayerId: string | null;
    highestScore: number;
    highestPlayerId: string | null;
    turns: number;
    passed: string[];
  } | null;
  lastPlay: PlayRecord | null;
  playedCards: Array<PlayRecord | { playerId: string; pass: true }>;
  handCounts: Record<string, number>;
  round: {
    number: number;
    starterSeat: number;
    passCount: number;
    multiplier: number;
    baseScore: number;
    playCounts: Record<string, number>;
  };
  result: {
    winnerTeam: 'landlord' | 'farmers';
    winnerIds: string[];
    deltas: Record<string, number>;
    spring: boolean;
    multiplier: number;
  } | null;
  message: string;
};

export type RoomPlayerLike = {
  id: string;
  name: string;
};
