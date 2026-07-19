/**
 * 延迟无关的核心协议函数：本地确定性仿真、Worker 结构校验、
 * 以及双端共用的「应用一镖结果」。
 *
 * 关键性质：commit 自带逻辑时间轴坐标，Worker 校验坐标自洽性而非到达时刻，
 * 因此网络延迟不影响游戏结果（见 docs/networking.md §2）。
 */

import {
  SHOT_FLIGHT_MS,
  SLOW_SPEED_FACTOR,
  TIMING_TOLERANCE_MS,
  MULTISHOT_MAX,
  WIDE_WIDTH_FACTOR,
} from './constants';
import type {
  ActiveEvent,
  BoardDart,
  CommitRejectReason,
  GamePhase,
  GamePlayer,
  Rotation,
  ShotCommit,
  ShotOutcome,
  TurnSnapshot,
  ZoneEffect,
} from './protocol';
import {
  clampHealth,
  computeScore,
  findCollision,
  isValidAngle,
  normalizeAngle,
  rotationAngleAt,
  zoneContains,
} from './rules';

// ---------------------------------------------------------------------------
// 本地仿真（出手方客户端）
// ---------------------------------------------------------------------------

export interface ShotSimContext {
  darts: BoardDart[];
  rotation: Rotation;
  event: ActiveEvent | null;
  /** 当前 turn.logicalElapsed */
  logicalElapsed: number;
}

export interface ShotSimulation {
  fireElapsed: number;
  impactElapsed: number;
  boardAngle: number;
  rotationAfter: Rotation;
  outcome: ShotOutcome;
}

/**
 * 出手方按下发射时本地确定性仿真整支镖的结果。
 * 结果打包进 ShotCommit 提交，Worker 只做结构校验不重新仿真。
 */
export function simulateShot(
  ctx: ShotSimContext,
  args: {
    playerId: string;
    seatAngle: number;
    windowElapsed: number;
    widthFactor: number;
  },
): ShotSimulation {
  const fireElapsed = ctx.logicalElapsed + args.windowElapsed;
  const impactElapsed = fireElapsed + SHOT_FLIGHT_MS;
  const impactAngle = rotationAngleAt(ctx.rotation, impactElapsed);
  const boardAngle = normalizeAngle(args.seatAngle - impactAngle);

  const rotationAfter: Rotation = {
    anchorAngle: impactAngle,
    anchorElapsed: impactElapsed,
    speedFactor: ctx.rotation.speedFactor,
    direction: ctx.rotation.direction,
  };

  const collision = findCollision(ctx.darts, boardAngle, args.widthFactor);
  const outcome: ShotOutcome = {
    collision: collision ? { targetShotId: collision.id } : null,
    score: 0,
    zoneEffect: null,
  };

  if (!collision) {
    outcome.score = computeScore(ctx.darts, args.playerId, boardAngle, args.widthFactor);
    const zoneEffect = zoneEffectAt(ctx.event, boardAngle);
    if (zoneEffect) {
      outcome.zoneEffect = zoneEffect;
      if (zoneEffect.kind === 'slow') {
        rotationAfter.speedFactor = SLOW_SPEED_FACTOR;
        rotationAfter.direction = 1;
      }
    }
  }

  return { fireElapsed, impactElapsed, boardAngle, rotationAfter, outcome };
}

function zoneEffectAt(event: ActiveEvent | null, boardAngle: number): ZoneEffect | null {
  if (!event || event.zoneAngle === null || !zoneContains(event.zoneAngle, boardAngle)) {
    return null;
  }
  switch (event.kind) {
    case 'heal_zone':
      return { kind: 'heal' };
    case 'slow_zone':
      return { kind: 'slow' };
    case 'wide_zone':
      return { kind: 'wide' };
    case 'multishot_zone':
      return { kind: 'multishot' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 结构校验（Worker）
// ---------------------------------------------------------------------------

export interface ShotValidationContext {
  phase: GamePhase;
  turn: TurnSnapshot | null;
  darts: BoardDart[];
  rotation: Rotation;
  event: ActiveEvent | null;
}

export type ShotValidation =
  | { ok: true }
  | { ok: false; reason: CommitRejectReason };

const VALID_SCORES = new Set([10, 30, 60, 100]);

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TIMING_TOLERANCE_MS;
}

/**
 * Worker 不重新仿真（无法知道玩家真实按下时刻），只对 commit 做严格
 * 结构/一致性校验。见 docs/networking.md §4。
 */
export function validateShotCommit(
  ctx: ShotValidationContext,
  playerId: string,
  commit: ShotCommit,
): ShotValidation {
  const { turn } = ctx;
  if (ctx.phase !== 'playing' || !turn) return { ok: false, reason: 'NO_ACTIVE_TURN' };
  if (playerId !== turn.playerId) return { ok: false, reason: 'NOT_CURRENT_PLAYER' };
  if (commit.turnId !== turn.id || commit.revision !== turn.revision) {
    return { ok: false, reason: 'STALE_TURN' };
  }
  if (turn.acceptedShotIds.includes(commit.shotId)) return { ok: false, reason: 'DUPLICATE' };
  if (commit.seq !== turn.lastAcceptedSeq + 1) return { ok: false, reason: 'OUT_OF_ORDER' };

  // 时间戳链自洽性
  if (
    !Number.isFinite(commit.windowElapsed) ||
    commit.windowElapsed < 0 ||
    commit.windowElapsed > turn.durationMs ||
    !near(commit.fireElapsed, turn.logicalElapsed + commit.windowElapsed) ||
    commit.fireElapsed > turn.durationMs + TIMING_TOLERANCE_MS ||
    !near(commit.impactElapsed, commit.fireElapsed + SHOT_FLIGHT_MS)
  ) {
    return { ok: false, reason: 'BAD_TIMING' };
  }

  if (!isValidAngle(commit.boardAngle)) return { ok: false, reason: 'BAD_ANGLE' };
  if (commit.widthFactor !== turn.dartWidth) return { ok: false, reason: 'BAD_WIDTH' };

  // rotationAfter：锚定于 impactElapsed、角度合法、速度/方向符合规则
  const ra = commit.rotationAfter;
  if (!near(ra.anchorElapsed, commit.impactElapsed) || !isValidAngle(ra.anchorAngle)) {
    return { ok: false, reason: 'BAD_ROTATION' };
  }
  if (commit.outcome.zoneEffect?.kind === 'slow') {
    if (ra.speedFactor !== SLOW_SPEED_FACTOR || ra.direction !== 1) {
      return { ok: false, reason: 'BAD_ROTATION' };
    }
  } else if (ra.speedFactor !== ctx.rotation.speedFactor || ra.direction !== ctx.rotation.direction) {
    return { ok: false, reason: 'BAD_ROTATION' };
  }

  // 碰撞申报一致性
  const { outcome } = commit;
  if (outcome.collision) {
    if (!ctx.darts.some((d) => d.id === outcome.collision!.targetShotId)) {
      return { ok: false, reason: 'BAD_COLLISION_TARGET' };
    }
    if (outcome.score !== 0 || outcome.zoneEffect !== null) {
      return { ok: false, reason: 'BAD_COLLISION_RESULT' };
    }
  } else if (!VALID_SCORES.has(outcome.score)) {
    return { ok: false, reason: 'BAD_SCORE' };
  }

  // 区域效果与当前事件类型一致
  if (outcome.zoneEffect) {
    const expected: Record<string, string> = {
      heal: 'heal_zone',
      slow: 'slow_zone',
      wide: 'wide_zone',
      multishot: 'multishot_zone',
    };
    if (!ctx.event || ctx.event.kind !== expected[outcome.zoneEffect.kind]) {
      return { ok: false, reason: 'BAD_ZONE_EFFECT' };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 应用结果（Worker 权威 + 客户端预测，唯一实现）
// ---------------------------------------------------------------------------

/** applyShotOutcome 需要的最小状态面（Worker 的 GameState 与客户端副本都满足） */
export interface ShotApplyTarget {
  players: Record<string, GamePlayer>;
  darts: BoardDart[];
  rotation: Rotation;
  turn: TurnSnapshot | null;
}

export interface AppliedShotEffects {
  playerId: string;
  collisionTargetId: string | null;
  scoreDelta: number;
  zoneEffect: ZoneEffect | null;
  healthBefore: number;
  healthAfter: number;
  healthReason: 'collision' | 'zone' | null;
  eliminated: boolean;
}

/**
 * 把一镖的结果应用到状态上。Worker 与客户端预测共用这一份实现，
 * 规则变化只需改这里（消除双份逻辑漂移）。
 *
 * 前置：commit 已通过 validateShotCommit（Worker）或来自本地 simulateShot（预测）。
 *
 * opts.multishotShots：多镖罚单的权威裁定支数（2~3），由 Worker 在命中时随机
 * 给出；客户端预测不传，先按上限 MULTISHOT_MAX 展示，下一回合快照会覆盖为权威值。
 */
export function applyShotOutcome(
  target: ShotApplyTarget,
  playerId: string,
  commit: ShotCommit,
  opts?: { multishotShots?: number },
): AppliedShotEffects {
  const player = target.players[playerId];
  if (!player || !target.turn) {
    throw new Error('applyShotOutcome: missing player or turn');
  }
  const turn = target.turn;

  turn.committed += 1;
  turn.lastAcceptedSeq = commit.seq;
  turn.acceptedShotIds.push(commit.shotId);
  turn.logicalElapsed = commit.impactElapsed;

  player.stats.shots += 1;

  const healthBefore = player.health;
  let healthReason: 'collision' | 'zone' | null = null;
  let scoreDelta = 0;

  if (commit.outcome.collision) {
    // 碰撞：不钉板、不得分，−1 血
    player.health = clampHealth(player.health - 1);
    player.stats.collisions += 1;
    healthReason = 'collision';
  } else {
    target.darts.push({
      id: commit.shotId,
      ownerId: playerId,
      boardAngle: commit.boardAngle,
      widthFactor: commit.widthFactor,
    });
    player.score += commit.outcome.score;
    player.stats.safeHits += 1;
    scoreDelta = commit.outcome.score;
  }

  const zoneEffect = commit.outcome.zoneEffect;
  if (zoneEffect) {
    switch (zoneEffect.kind) {
      case 'heal':
        player.health = clampHealth(player.health + 1);
        healthReason = 'zone';
        break;
      case 'wide':
        player.nextTurnWidth = WIDE_WIDTH_FACTOR;
        break;
      case 'multishot':
        player.nextTurnShots = opts?.multishotShots ?? MULTISHOT_MAX;
        break;
      case 'slow':
        // 减速由 commit.rotationAfter 体现，无额外状态
        break;
    }
  }

  target.rotation = { ...commit.rotationAfter };

  let eliminated = false;
  if (player.status === 'alive' && player.health <= 0) {
    player.status = 'eliminated';
    eliminated = true;
  }

  return {
    playerId,
    collisionTargetId: commit.outcome.collision?.targetShotId ?? null,
    scoreDelta,
    zoneEffect,
    healthBefore,
    healthAfter: player.health,
    healthReason,
    eliminated,
  };
}

// ---------------------------------------------------------------------------
// 超时
// ---------------------------------------------------------------------------

/** 超时伤害 = 未射支数 */
export function timeoutDamage(turn: Pick<TurnSnapshot, 'required' | 'committed'>): number {
  return Math.max(0, turn.required - turn.committed);
}
