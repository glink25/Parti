export type Ruleset = 'classic' | 'devil' | 'chaos';
export type TableRank = 'A' | 'K' | 'Q';
export type CardKind = TableRank | 'joker' | 'master' | 'chaos';
export type GamePhase = 'lobby' | 'playing' | 'roulette' | 'resolution' | 'finished';

export type Card = {
  id: string;
  kind: CardKind;
  devilMarked?: boolean;
};

export type MatchPlayerInput = {
  id: string;
  name: string;
  role: 'host' | 'player';
  wins?: number;
};

export type PlayerState = MatchPlayerInput & {
  seat: number;
  ready: boolean;
  connected: boolean;
  alive: boolean;
  handCount: number;
  safePulls: number;
  wins: number;
};

export type PlayRecord = {
  playerId: string;
  cards: Card[];
};

export type RevealState = {
  reason: 'liar' | 'devil' | 'devils-deal' | 'master' | 'chaos';
  accusedId: string | null;
  callerId: string | null;
  cards: Card[];
};

export type ShotResult = {
  shooterId: string;
  targetId: string;
  lethal: boolean;
};

export type ResumeMode = 'redeal' | 'continue';

export type RouletteState = {
  kind: 'self' | 'targeted' | 'simultaneous';
  shooterIds: string[];
  fixedTargets: Record<string, string>;
  committed: string[];
  resume: ResumeMode;
  starterId: string;
};

export type ResolutionState = {
  shots: ShotResult[];
  resume: ResumeMode;
  starterId: string;
};

export type GameState = {
  version: 1;
  actionSequence: number;
  phase: GamePhase;
  ruleset: Ruleset;
  hostId: string;
  players: Record<string, PlayerState>;
  seats: Array<string | null>;
  round: number;
  tableRank: TableRank | null;
  currentPlayerId: string | null;
  lastPlay: { playerId: string; count: number } | null;
  pileCount: number;
  reveal: RevealState | null;
  roulette: RouletteState | null;
  resolution: ResolutionState | null;
  winnerId: string | null;
  draw: boolean;
  message: string;
};

export type SecretState = {
  hands: Record<string, Card[]>;
  deck: Card[];
  pile: PlayRecord[];
  fatalPulls: Record<string, number>;
  shotTargets: Record<string, string>;
};

export type GameSession = {
  state: GameState;
  secret: SecretState;
};

export type MatchConfig = {
  hostId: string;
  players: MatchPlayerInput[];
  ruleset: Ruleset;
  start?: boolean;
};

export type RoomActionPayloads = {
  setReady: { ready: boolean };
  setRuleset: { ruleset: Ruleset };
  playCards: { cardIds: string[] };
  callLiar: undefined;
  callDevilsDeal: undefined;
  pullTrigger: { targetId?: string } | undefined;
  syncPrivate: undefined;
  abortMatch: undefined;
};

export type RoomEventPayloads = {
  'private:hand': { hand: Card[] };
  'game:invalid': { message: string };
  'game:notice': { message: string };
  'game:reveal': RevealState | null;
  'game:shots': { shots: ShotResult[]; finished: boolean };
  'game:round': { round: number; tableRank: TableRank | null };
  'game:start': { ruleset: Ruleset };
  'game:aborted': Record<string, never>;
  'game:action': {
    actionId: string;
    occurredAt: number;
    kind: 'cardsCommitted' | 'reveal' | 'shots' | 'specialResolved' | 'roundSettled';
    actorId?: string;
    targetIds?: string[];
    count?: number;
    cards?: Card[];
    shots?: ShotResult[];
    label?: string;
  };
};

export type RoomActionName = keyof RoomActionPayloads;
export type RoomEventName = keyof RoomEventPayloads;

type RoomEffect = {
  [Event in RoomEventName]: { event: Event; payload: RoomEventPayloads[Event] };
}[RoomEventName];

export type PrivateEffect = RoomEffect & { playerId: string };
export type PublicEffect = RoomEffect;

export type InternalCommand = { type: 'advanceResolution'; actorId: string };

export type Command =
  | { type: 'playerJoined'; actorId: string; player: MatchPlayerInput }
  | { type: 'playerLeft'; actorId: string }
  | { type: 'playerReconnected'; actorId: string; name: string }
  | { type: 'setReady'; actorId: string; ready: boolean }
  | { type: 'setRuleset'; actorId: string; ruleset: Ruleset }
  | { type: 'playCards'; actorId: string; cardIds: string[] }
  | { type: 'callLiar'; actorId: string }
  | { type: 'callDevilsDeal'; actorId: string }
  | { type: 'pullTrigger'; actorId: string; targetId?: string }
  | { type: 'syncPrivate'; actorId: string }
  | { type: 'abortMatch'; actorId: string }
  | InternalCommand;

export type ScheduledEffect = {
  name: string;
  ms: number;
  command: InternalCommand;
};

export type Transition = {
  session: GameSession;
  sends: PrivateEffect[];
  broadcasts: PublicEffect[];
  schedules: ScheduledEffect[];
  error?: string;
};

export type RandomSource = () => number;

export type RouletteSetup = {
  kind: RouletteState['kind'];
  shooters: string[];
  fixedTargets: Record<string, string>;
  resume: ResumeMode;
  starterId: string;
};
