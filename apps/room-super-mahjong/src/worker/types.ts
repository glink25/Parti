export type Suit = 'm' | 'p' | 's';
export type NumberTileKind = `${Suit}${1|2|3|4|5|6|7|8|9}`;
export type TileKind = NumberTileKind | 'z';

export type Tile = { id: string; kind: TileKind };
export type MeldKind = 'chi' | 'peng' | 'gang';
export type Meld = { kind: MeldKind; tiles: Tile[]; fromSeat: number | null; concealed?: boolean };
export type ReactionKind = 'win' | 'gang' | 'peng' | 'chi';
export type ReactionClaim = { playerId: string; seat: number; kind: ReactionKind; tiles?: string[] };

export type RulesConfig = {
  winSource: 'both' | 'selfDrawOnly' | 'discardOnly';
  allowChi: boolean;
  allowMultiWin: boolean;
  allowRobGang: boolean;
  allowLastTile: boolean;
  rounds: 1 | 4 | 8;
  baseScore: number;
  maxFan: number;
};

export type WinAnalysis = {
  winning: boolean;
  standard: boolean;
  sevenPairs: boolean;
  allPungs: boolean;
  pureSuit: boolean;
};

export type WinFeatures = Omit<WinAnalysis, 'winning'> & {
  selfDraw: boolean;
  gangBloom: boolean;
  robGang: boolean;
  lastTile: boolean;
};
