/**
 * 协议类型：state 快照、commit、事件 payload。
 * 这是 UI 与 Worker 之间的契约（schema: 'dart-now@1'）。
 */

export const STATE_SCHEMA = 'dart-now@1';

// ---------------------------------------------------------------------------
// 权威状态
// ---------------------------------------------------------------------------

export type GamePhase = 'lobby' | 'playing' | 'finished';
export type PlayerStatus = 'waiting' | 'queued' | 'alive' | 'eliminated';

export interface PlayerStats {
  shots: number;
  safeHits: number;
  collisions: number;
  timeouts: number;
}

export interface GamePlayer {
  id: string;
  name: string;
  isHost: boolean;
  status: PlayerStatus;
  connected: boolean;
  ready: boolean;
  /** 座位序号（决定出手方向与颜色），未入座为 -1 */
  seat: number;
  health: number;
  score: number;
  stats: PlayerStats;
  /** 下回合需射几支（被区域事件修改，消费后还原为 1） */
  nextTurnShots: number;
  /** 下回合镖宽度因子（同上，还原为 1） */
  nextTurnWidth: number;
}

/**
 * 确定性旋转模型：任意逻辑时刻的转角是纯函数。
 * 角度约定：0 在 12 点方向，顺时针为正（屏幕坐标系）。
 */
export interface Rotation {
  anchorAngle: number;
  anchorElapsed: number;
  speedFactor: number;
  direction: 1 | -1;
}

/** 钉在板上的镖，记录板面角（随板一起转） */
export interface BoardDart {
  id: string;
  ownerId: string;
  boardAngle: number;
  widthFactor: number;
}

export type EventKind =
  | 'speed_up'
  | 'reverse'
  | 'heal_zone'
  | 'slow_zone'
  | 'wide_zone'
  | 'multishot_zone';

export interface ActiveEvent {
  kind: EventKind;
  /** 区域事件的区域中心角（板面角）；非区域事件为 null */
  zoneAngle: number | null;
}

export interface TurnSnapshot {
  /** turn-{turnRevision}-{playerId} */
  id: string;
  revision: number;
  playerId: string;
  /** 本回合需射支数 */
  required: number;
  /** 已被接受的支数 */
  committed: number;
  durationMs: number;
  dartWidth: number;
  /** 本回合时间轴上已确认的进度（最近一镖的命中时刻） */
  logicalElapsed: number;
  lastAcceptedSeq: number;
  /** 已接受的 shotId，用于幂等去重 */
  acceptedShotIds: string[];
}

export interface GameState {
  schema: typeof STATE_SCHEMA;
  phase: GamePhase;
  hostId: string | null;
  players: Record<string, GamePlayer>;
  /** 出手顺序（玩家 id），开局洗牌确定 */
  activeOrder: string[];
  currentIndex: number;
  turn: TurnSnapshot | null;
  rotation: Rotation;
  darts: BoardDart[];
  event: ActiveEvent | null;
  lastEventKind: EventKind | null;
  shotsSinceEvent: number;
  nextEventAt: number;
  eventDue: boolean;
  /** 单调递增：镖盘/血量等盘面数据变化 */
  boardRevision: number;
  /** 单调递增：回合代际 */
  turnRevision: number;
  winnerId: string | null;
  round: number;
}

// ---------------------------------------------------------------------------
// Action payload（客户端 → Worker）
// ---------------------------------------------------------------------------

export type ZoneEffectKind = 'heal' | 'slow' | 'wide' | 'multishot';

export interface ZoneEffect {
  kind: ZoneEffectKind;
}

export interface ShotOutcome {
  collision: { targetShotId: string } | null;
  score: number;
  zoneEffect: ZoneEffect | null;
}

export interface ShotCommit {
  turnId: string;
  revision: number;
  shotId: string;
  seq: number;
  /** 本地回合窗口内经过的时间（从窗口起点到按下） */
  windowElapsed: number;
  /** 开火点（逻辑时间轴上）= turn.logicalElapsed + windowElapsed */
  fireElapsed: number;
  /** 命中点 = fireElapsed + SHOT_FLIGHT_MS */
  impactElapsed: number;
  boardAngle: number;
  widthFactor: number;
  /** 命中后的新旋转锚点（anchorElapsed = impactElapsed） */
  rotationAfter: Rotation;
  outcome: ShotOutcome;
}

export interface TimeoutCommit {
  turnId: string;
  revision: number;
  finalElapsed: number;
  rotationEndAngle: number;
}

export interface AcceptTurnPayload {
  turnId: string;
  revision: number;
}

// ---------------------------------------------------------------------------
// 事件 payload（Worker → 客户端），命名空间 dart:*
// ---------------------------------------------------------------------------

export type LobbyErrorReason =
  | 'not-host'
  | 'bad-phase'
  | 'too-few-players'
  | 'not-all-ready'
  | 'not-finished'
  | 'unknown-player';

export type CommitRejectReason =
  | 'NO_ACTIVE_TURN'
  | 'NOT_CURRENT_PLAYER'
  | 'STALE_TURN'
  | 'DUPLICATE'
  | 'OUT_OF_ORDER'
  | 'BAD_TIMING'
  | 'BAD_ANGLE'
  | 'BAD_WIDTH'
  | 'BAD_ROTATION'
  | 'BAD_COLLISION_TARGET'
  | 'BAD_COLLISION_RESULT'
  | 'BAD_SCORE'
  | 'BAD_ZONE_EFFECT';

export type HealthChangeReason = 'collision' | 'zone' | 'turn-timeout' | 'connection-timeout';

export interface DartEventMap {
  'dart:lobby-error': { reason: LobbyErrorReason };
  'dart:game-started': { activeOrder: string[] };
  'dart:turn-granted': { turn: TurnSnapshot };
  'dart:round-started': { round: number; durationMs: number };
  'dart:shot-committed': { commit: ShotCommit; playerId: string };
  'dart:commit-rejected': {
    turnId: string;
    revision: number;
    reason: CommitRejectReason;
    boardRevision: number;
  };
  'dart:zone-triggered': { playerId: string; effect: ZoneEffect; eventKind: EventKind };
  'dart:health-changed': {
    playerId: string;
    health: number;
    delta: number;
    reason: HealthChangeReason;
  };
  'dart:player-eliminated': { playerId: string };
  'dart:timeout': { playerId: string; damage: number; watchdog: boolean };
  'dart:event': { event: ActiveEvent };
  'dart:game-over': { winnerId: string | null };
}
