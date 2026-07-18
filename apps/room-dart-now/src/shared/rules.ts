/**
 * 纯函数几何/规则库：角度、旋转模型、碰撞、计分、区域判定、洗牌、座位。
 * 无框架依赖，客户端与 Worker 共用。
 *
 * 角度约定：0 在 12 点方向，顺时针为正；板面角 = 世界角 − 标靶转角。
 */

import {
  BASE_ROTATION_MS,
  INITIAL_TURN_MS,
  MAX_HEALTH,
  MIN_TURN_MS,
  STANDARD_DART_ANGLE,
  TAU,
  TURN_DECAY_MS,
  ZONE_ARC,
  ZONE_CANDIDATES,
} from './constants';
import type { BoardDart, Rotation } from './protocol';

// ---------------------------------------------------------------------------
// 角度
// ---------------------------------------------------------------------------

/** 归一到 [0, TAU) */
export function normalizeAngle(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

/** 两角最短距离，[0, π] */
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return d > Math.PI ? TAU - d : d;
}

export function isValidAngle(angle: number): boolean {
  return Number.isFinite(angle) && angle >= 0 && angle < TAU;
}

// ---------------------------------------------------------------------------
// 旋转模型
// ---------------------------------------------------------------------------

/** 任意逻辑时刻的标靶转角（纯函数，全网共识） */
export function rotationAngleAt(rotation: Rotation, elapsed: number): number {
  const turns =
    ((elapsed - rotation.anchorElapsed) / BASE_ROTATION_MS) *
    rotation.speedFactor *
    rotation.direction;
  return normalizeAngle(rotation.anchorAngle + turns * TAU);
}

/** 把当前转角重新锚定到新的逻辑时刻，可叠加新的速度/方向 */
export function reanchorRotation(
  rotation: Rotation,
  elapsed: number,
  speedFactor = rotation.speedFactor,
  direction: 1 | -1 = rotation.direction,
): Rotation {
  return {
    anchorAngle: rotationAngleAt(rotation, elapsed),
    anchorElapsed: elapsed,
    speedFactor,
    direction,
  };
}

// ---------------------------------------------------------------------------
// 座位与方向
// ---------------------------------------------------------------------------

/** 座位的世界方向：12 点起按 seat 均分（出手方向固定于此） */
export function seatWorldAngle(seat: number, seatCount: number): number {
  return normalizeAngle((seat * TAU) / Math.max(1, seatCount));
}

// ---------------------------------------------------------------------------
// 回合时限
// ---------------------------------------------------------------------------

export function turnDurationForRound(round: number): number {
  return Math.max(MIN_TURN_MS, INITIAL_TURN_MS - (round - 1) * TURN_DECAY_MS);
}

// ---------------------------------------------------------------------------
// 生命
// ---------------------------------------------------------------------------

export function clampHealth(health: number): number {
  return Math.max(0, Math.min(MAX_HEALTH, health));
}

// ---------------------------------------------------------------------------
// 碰撞与计分
// ---------------------------------------------------------------------------

/** 两镖碰撞的角距阈值 */
export function collisionThreshold(widthA: number, widthB: number): number {
  return (STANDARD_DART_ANGLE * (widthA + widthB)) / 2;
}

/** 两镖的边到边角间隙（负数表示重叠） */
export function edgeGap(
  angleA: number,
  widthA: number,
  angleB: number,
  widthB: number,
): number {
  return angularDistance(angleA, angleB) - collisionThreshold(widthA, widthB);
}

/**
 * 碰撞检测：新镖与板上任意镖（含己方）角距 ≤ 阈值即碰撞。
 * 返回距离最近的一支作为目标，无碰撞返回 null。
 */
export function findCollision(
  darts: BoardDart[],
  boardAngle: number,
  widthFactor: number,
): BoardDart | null {
  let best: BoardDart | null = null;
  let bestDist = Infinity;
  for (const dart of darts) {
    const dist = angularDistance(dart.boardAngle, boardAngle);
    if (dist <= collisionThreshold(dart.widthFactor, widthFactor) && dist < bestDist) {
      best = dart;
      bestDist = dist;
    }
  }
  return best;
}

/** 边到边间隙（以标准镖角半径为单位）→ 得分 */
export function scoreForGapUnits(gapUnits: number): number {
  if (gapUnits <= 0.5) return 100;
  if (gapUnits <= 1.5) return 60;
  if (gapUnits <= 3) return 30;
  return 10;
}

/**
 * 安全命中计分：取与最近「敌方」镖的边到边间隙换算得分。
 * 己方镖不参与计分（但参与碰撞，见 findCollision）。无敌方镖时 10 分。
 */
export function computeScore(
  darts: BoardDart[],
  ownerId: string,
  boardAngle: number,
  widthFactor: number,
): number {
  let minGap = Infinity;
  for (const dart of darts) {
    if (dart.ownerId === ownerId) continue;
    const gap = edgeGap(dart.boardAngle, dart.widthFactor, boardAngle, widthFactor);
    if (gap < minGap) minGap = gap;
  }
  if (!Number.isFinite(minGap)) return 10;
  return scoreForGapUnits(minGap / STANDARD_DART_ANGLE);
}

// ---------------------------------------------------------------------------
// 区域判定
// ---------------------------------------------------------------------------

/** 命中是否落在事件区域内（边界含端点） */
export function zoneContains(zoneAngle: number, boardAngle: number): boolean {
  return angularDistance(zoneAngle, boardAngle) <= ZONE_ARC / 2 + 1e-9;
}

/**
 * 在 ZONE_CANDIDATES 个采样候选中选离现有镖最远的区域中心。
 * 并列时用 random 打破。
 */
export function pickZoneAngle(darts: BoardDart[], random: () => number): number {
  let bestAngle = 0;
  let bestClearance = -1;
  let ties = 0;
  for (let i = 0; i < ZONE_CANDIDATES; i += 1) {
    const candidate = (i * TAU) / ZONE_CANDIDATES;
    let clearance = Math.PI;
    for (const dart of darts) {
      const dist = angularDistance(candidate, dart.boardAngle);
      if (dist < clearance) clearance = dist;
    }
    if (clearance > bestClearance + 1e-9) {
      bestClearance = clearance;
      bestAngle = candidate;
      ties = 1;
    } else if (Math.abs(clearance - bestClearance) <= 1e-9) {
      ties += 1;
      if (random() < 1 / ties) bestAngle = candidate;
    }
  }
  return bestAngle;
}

// ---------------------------------------------------------------------------
// 洗牌
// ---------------------------------------------------------------------------

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
