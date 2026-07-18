/**
 * 回合生命周期：beginTurn / advanceTurn / applyAcceptedShot / applyTimeout / 看门狗。
 * 状态机见 docs/game-flow.md §5。
 */

import { BASE_ROTATION_MS, MAX_HEALTH, TAU, TIMING_TOLERANCE_MS, WATCHDOG_MS } from '../shared/constants';
import type { GamePlayer, GameState, ShotCommit, TimeoutCommit } from '../shared/protocol';
import { angularDistance, clampHealth, rotationAngleAt, turnDurationForRound } from '../shared/rules';
import { applyShotOutcome, timeoutDamage } from '../shared/shot';
import type { WorkerContext } from './context';
import { triggerRandomEvent } from './events';

const WATCHDOG_TIMER = 'turn-watchdog';

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 把 rotation 锚点归一到当前时间轴终点（elapsed），并把 anchorElapsed 归零——
 * 每个回合是一条独立的逻辑时间轴，新回合从 0 起算，锚定保证转角跨回合连续。
 */
function normalizeRotationAt(state: GameState, elapsed: number): void {
  state.rotation = {
    anchorAngle: rotationAngleAt(state.rotation, elapsed),
    anchorElapsed: 0,
    speedFactor: state.rotation.speedFactor,
    direction: state.rotation.direction,
  };
}

function eliminate(ctx: WorkerContext, player: GamePlayer): void {
  if (player.status !== 'alive') return;
  player.status = 'eliminated';
  ctx.broadcast('dart:player-eliminated', { playerId: player.id });
}

// ---------------------------------------------------------------------------
// 看门狗
// ---------------------------------------------------------------------------

/** 启动/重置看门狗：出手方 20s 无响应则强制超时（离线不阻塞对局的关键） */
export function armWatchdog(ctx: WorkerContext): void {
  ctx.setTimer(WATCHDOG_TIMER, WATCHDOG_MS, () => {
    applyTimeout(ctx, true);
  });
}

// ---------------------------------------------------------------------------
// 回合推进
// ---------------------------------------------------------------------------

export function beginTurn(ctx: WorkerContext, playerId: string): void {
  const { state } = ctx;
  const player = state.players[playerId];
  if (!player) return;

  state.turnRevision += 1;
  state.turn = {
    id: `turn-${state.turnRevision}-${playerId}`,
    revision: state.turnRevision,
    playerId,
    required: player.nextTurnShots,
    committed: 0,
    durationMs: turnDurationForRound(state.round),
    dartWidth: player.nextTurnWidth,
    logicalElapsed: 0,
    lastAcceptedSeq: 0,
    acceptedShotIds: [],
  };
  // 区域事件授予的下回合修饰，消费一次即还原
  player.nextTurnShots = 1;
  player.nextTurnWidth = 1;

  ctx.broadcast('dart:turn-granted', { turn: state.turn });
  armWatchdog(ctx);
}

export function advanceTurn(ctx: WorkerContext): void {
  const { state } = ctx;
  ctx.clearTimer(WATCHDOG_TIMER);
  state.turn = null;

  if (finishIfNeeded(ctx)) return;

  // 事件不打断进行中的回合，统一在回合间隙触发
  if (state.eventDue) triggerRandomEvent(ctx);

  const order = state.activeOrder;
  const from = state.currentIndex;
  for (let step = 1; step <= order.length; step += 1) {
    const next = (from + step) % order.length;
    const candidate = state.players[order[next]];
    if (candidate?.status === 'alive') {
      if (next <= from) {
        // 指针回绕：轮 +1，时限收紧
        state.round += 1;
        ctx.broadcast('dart:round-started', {
          round: state.round,
          durationMs: turnDurationForRound(state.round),
        });
      }
      state.currentIndex = next;
      beginTurn(ctx, candidate.id);
      return;
    }
  }
  // 没有可行动玩家（正常路径已被 finishIfNeeded 拦截）
  finishGame(ctx, null);
}

export function finishIfNeeded(ctx: WorkerContext): boolean {
  const { state } = ctx;
  if (state.phase !== 'playing') return false;
  const alive = state.activeOrder.filter((id) => state.players[id]?.status === 'alive');
  if (alive.length > 1) return false;
  finishGame(ctx, alive[0] ?? null);
  return true;
}

export function finishGame(ctx: WorkerContext, winnerId: string | null): void {
  const { state } = ctx;
  ctx.clearTimer(WATCHDOG_TIMER);
  state.phase = 'finished';
  state.turn = null;
  state.winnerId = winnerId;
  ctx.broadcast('dart:game-over', { winnerId });
}

// ---------------------------------------------------------------------------
// 一镖的应用（commit 已通过校验）
// ---------------------------------------------------------------------------

export function applyAcceptedShot(ctx: WorkerContext, playerId: string, commit: ShotCommit): void {
  const { state } = ctx;
  const turn = state.turn;
  if (!turn) return;

  const effects = applyShotOutcome(state, playerId, commit);
  state.boardRevision += 1;

  // 随机事件节奏：达到 nextEventAt 时置 eventDue，下一回合间隙触发
  state.shotsSinceEvent += 1;
  if (state.shotsSinceEvent >= state.nextEventAt) state.eventDue = true;

  ctx.broadcast('dart:shot-committed', { commit, playerId });
  if (effects.zoneEffect && state.event) {
    ctx.broadcast('dart:zone-triggered', {
      playerId,
      effect: effects.zoneEffect,
      eventKind: state.event.kind,
    });
  }
  if (effects.healthAfter !== effects.healthBefore && effects.healthReason) {
    ctx.broadcast('dart:health-changed', {
      playerId,
      health: effects.healthAfter,
      delta: effects.healthAfter - effects.healthBefore,
      reason: effects.healthReason,
    });
  }
  if (effects.eliminated) {
    const player = state.players[playerId];
    if (player) eliminate(ctx, player);
  }

  // 射满或被淘汰 → 回合结束，锚点归一后推进
  if (effects.eliminated || turn.committed >= turn.required) {
    normalizeRotationAt(state, turn.logicalElapsed);
    advanceTurn(ctx);
  }
}

// ---------------------------------------------------------------------------
// 超时
// ---------------------------------------------------------------------------

/** commit_timeout 的结构校验：finalElapsed / rotationEndAngle 需与权威推算一致 */
export function isTimeoutCommitValid(
  state: GameState,
  playerId: string,
  commit: TimeoutCommit,
): boolean {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn) return false;
  if (playerId !== turn.playerId) return false;
  if (commit.turnId !== turn.id || commit.revision !== turn.revision) return false;
  const finalElapsed = Math.max(turn.durationMs, turn.logicalElapsed);
  if (Math.abs(commit.finalElapsed - finalElapsed) > TIMING_TOLERANCE_MS) return false;
  const expectedAngle = rotationAngleAt(state.rotation, finalElapsed);
  const angleTolerance =
    (TIMING_TOLERANCE_MS / BASE_ROTATION_MS) * TAU * state.rotation.speedFactor + 1e-9;
  return angularDistance(commit.rotationEndAngle, expectedAngle) <= angleTolerance;
}

/** 超时结算：伤害 = 未射支数。watchdog=true 表示连接无响应被强制执行 */
export function applyTimeout(ctx: WorkerContext, watchdog: boolean): void {
  const { state } = ctx;
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn) return;

  const player = state.players[turn.playerId];
  const damage = timeoutDamage(turn);
  const finalElapsed = Math.max(turn.durationMs, turn.logicalElapsed);

  normalizeRotationAt(state, finalElapsed);

  ctx.broadcast('dart:timeout', { playerId: turn.playerId, damage, watchdog });

  if (player && damage > 0) {
    const before = player.health;
    player.health = clampHealth(player.health - damage);
    player.stats.timeouts += 1;
    state.boardRevision += 1;
    if (player.health !== before) {
      ctx.broadcast('dart:health-changed', {
        playerId: player.id,
        health: player.health,
        delta: player.health - before,
        reason: watchdog ? 'connection-timeout' : 'turn-timeout',
      });
    }
    if (player.health <= 0) eliminate(ctx, player);
  }

  advanceTurn(ctx);
}

// ---------------------------------------------------------------------------
// 对局数据重置
// ---------------------------------------------------------------------------

export function resetGameData(player: GamePlayer): void {
  player.health = MAX_HEALTH;
  player.score = 0;
  player.stats = { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 };
  player.nextTurnShots = 1;
  player.nextTurnWidth = 1;
}
