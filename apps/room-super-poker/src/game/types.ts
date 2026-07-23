export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds' | 'joker';
export type VariantId = 'doudizhu' | 'gandengyan' | 'chameleon';
export type Card = { id: string; suit: Suit; rank: number; label: string };
export type Phase = 'lobby' | 'dealing' | 'bidding' | 'playing' | 'settlement';
export type SeatState = { id: string; name: string; seat: number; bot: boolean; connected: boolean; ready: boolean; handCount: number; score: number; role: 'landlord'|'farmer'|null };
export type PlayAnalysis = { type: string; rank: number; length: number; label: string; chainLength?: number };
export type TablePlay = { playerId: string; cards: Card[]; analysis?: PlayAnalysis; choice?: { suit?: Suit; rank?: number } };
export type Settlement = { winnerIds: string[]; deltas: Record<string, number>; title: string; detail: string };
export type VariantMeta = { id: VariantId; name: string; minPlayers: number; maxPlayers: number; rules: string[] };
export type VariantPublicState = {
  bid?: { currentPlayerId: string; highestScore: number; highestPlayerId: string|null; turns: number };
  landlordCards?: Card[]; multiplier?: number; passCount?: number; bombs?: number; deckCount?: number;
  activeSuit?: Suit; activeRank?: number; drawPending?: boolean;
};
export type GameState = { schema: 1; phase: Phase; variantId: VariantId; variants: VariantMeta[]; hostId: string|null; seats: Array<SeatState|null>; currentPlayerId: string|null; lastPlay: TablePlay|null; variant: VariantPublicState; settlement: Settlement|null; message: string; actionSeq: number };
export type PrivateState = { hand: Card[]; canPass: boolean; canDraw: boolean; needsChoice: boolean };
export type PartiApi = { playerId:string|null; getState():unknown; onState(handler:(state:unknown)=>void):()=>void; onEvent(event:string,handler:(payload:unknown)=>void):()=>void; action(action:string,payload?:unknown):Promise<{ok:true}>; ready():void; leave():void; log(...args:unknown[]):void; exposeToAgent?(describe:(state:unknown)=>unknown):void };
declare global { const parti: PartiApi; }
