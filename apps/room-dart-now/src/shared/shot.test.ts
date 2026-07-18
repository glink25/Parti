import { describe, expect, it } from 'vitest';
import { SHOT_FLIGHT_MS } from './constants';
import type {
  ActiveEvent,
  BoardDart,
  GamePlayer,
  Rotation,
  ShotCommit,
  TurnSnapshot,
} from './protocol';
import { computeScore } from './rules';
import {
  applyShotOutcome,
  simulateShot,
  timeoutDamage,
  validateShotCommit,
  type ShotApplyTarget,
  type ShotValidationContext,
} from './shot';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makePlayer(id: string, overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id,
    name: id,
    isHost: false,
    status: 'alive',
    connected: true,
    ready: true,
    seat: 0,
    health: 3,
    score: 0,
    stats: { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 },
    nextTurnShots: 1,
    nextTurnWidth: 1,
    ...overrides,
  };
}

function makeTurn(overrides: Partial<TurnSnapshot> = {}): TurnSnapshot {
  return {
    id: 'turn-1-p1',
    revision: 1,
    playerId: 'p1',
    required: 1,
    committed: 0,
    durationMs: 15000,
    dartWidth: 1,
    logicalElapsed: 0,
    lastAcceptedSeq: 0,
    acceptedShotIds: [],
    ...overrides,
  };
}

const BASE_ROTATION: Rotation = {
  anchorAngle: 0,
  anchorElapsed: 0,
  speedFactor: 1,
  direction: 1,
};

function makeCtx(overrides: Partial<ShotValidationContext> = {}): ShotValidationContext {
  return {
    phase: 'playing',
    turn: makeTurn(),
    darts: [],
    rotation: { ...BASE_ROTATION },
    event: null,
    ...overrides,
  };
}

function commitFromSimulation(
  turn: TurnSnapshot,
  sim: ReturnType<typeof simulateShot>,
  windowElapsed: number,
  overrides: Partial<ShotCommit> = {},
): ShotCommit {
  return {
    turnId: turn.id,
    revision: turn.revision,
    shotId: `shot-${turn.lastAcceptedSeq + 1}`,
    seq: turn.lastAcceptedSeq + 1,
    windowElapsed,
    fireElapsed: sim.fireElapsed,
    impactElapsed: sim.impactElapsed,
    boardAngle: sim.boardAngle,
    widthFactor: turn.dartWidth,
    rotationAfter: sim.rotationAfter,
    outcome: sim.outcome,
    ...overrides,
  };
}

function simulate(ctx: ShotValidationContext, windowElapsed: number, seatAngle = 0) {
  return simulateShot(
    {
      darts: ctx.darts,
      rotation: ctx.rotation,
      event: ctx.event,
      logicalElapsed: ctx.turn!.logicalElapsed,
    },
    { playerId: 'p1', seatAngle, windowElapsed, widthFactor: ctx.turn!.dartWidth },
  );
}

// ---------------------------------------------------------------------------
// 延迟无关的本地仿真
// ---------------------------------------------------------------------------

describe('latency-independent local simulation', () => {
  it('same logical inputs produce identical results regardless of wall clock', () => {
    const ctx = makeCtx({
      darts: [{ id: 'x', ownerId: 'p2', boardAngle: 1.0, widthFactor: 1 }],
    });
    // 同一逻辑输入，「不同时刻」仿真（simulateShot 不读取墙钟）——结果逐字段一致
    const a = simulate(ctx, 1000, 0.5);
    const b = simulate(ctx, 1000, 0.5);
    expect(a).toEqual(b);

    // 由此构造的 commit 通过 Worker 校验：校验只看逻辑坐标自洽性，看不到达时刻
    const commit = commitFromSimulation(ctx.turn!, a, 1000);
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: true });
  });

  it('impact is always SHOT_FLIGHT_MS after fire, on the logical timeline', () => {
    const ctx = makeCtx();
    const sim = simulate(ctx, 2500, 0);
    expect(sim.fireElapsed).toBe(2500);
    expect(sim.impactElapsed).toBe(2500 + SHOT_FLIGHT_MS);
    expect(sim.rotationAfter.anchorElapsed).toBe(sim.impactElapsed);
  });
});

// ---------------------------------------------------------------------------
// 计分带
// ---------------------------------------------------------------------------

describe('scoring bands', () => {
  it('rewards risky proximity to enemy darts', () => {
    const enemy: BoardDart = { id: 'e', ownerId: 'p2', boardAngle: 1.0, widthFactor: 1 };
    // 阈值 0.055；边到边间隙 = 距离 − 0.055
    expect(computeScore([enemy], 'p1', 1.07, 1)).toBe(100); // gap 0.015 ≤ 0.5 单位
    expect(computeScore([enemy], 'p1', 1.1, 1)).toBe(60); // gap 0.045 ≈ 0.82 单位
    expect(computeScore([enemy], 'p1', 1.2, 1)).toBe(30); // gap 0.145 ≈ 2.6 单位
    expect(computeScore([enemy], 'p1', 1.3, 1)).toBe(10); // gap 0.245 ≈ 4.5 单位
  });

  it('ignores own darts for scoring and defaults to 10 with no enemies', () => {
    const own: BoardDart = { id: 'o', ownerId: 'p1', boardAngle: 1.06, widthFactor: 1 };
    expect(computeScore([own], 'p1', 1.0, 1)).toBe(10);
    expect(computeScore([], 'p1', 1.0, 1)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 碰撞路径（仿真 → 校验 → 应用）
// ---------------------------------------------------------------------------

describe('collision flow', () => {
  it('simulates, validates and applies a collision: damage, no dart, no score', () => {
    const ctx = makeCtx({
      darts: [{ id: 'e', ownerId: 'p2', boardAngle: 1.0, widthFactor: 1 }],
    });
    // 找一个命中 1.0 附近的出手角：seatAngle = boardAngle + rotationAngleAt(impact)
    const probe = simulate(ctx, 1000, 0);
    const seatAngle = 1.0 + (0 - probe.boardAngle); // 调整使出镖落在 1.0
    const sim = simulate(ctx, 1000, seatAngle);
    expect(sim.boardAngle).toBeCloseTo(1.0, 5);
    expect(sim.outcome.collision).toEqual({ targetShotId: 'e' });
    expect(sim.outcome.score).toBe(0);

    const commit = commitFromSimulation(ctx.turn!, sim, 1000);
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: true });

    const target: ShotApplyTarget = {
      players: { p1: makePlayer('p1') },
      darts: [...ctx.darts],
      rotation: { ...BASE_ROTATION },
      turn: makeTurn(),
    };
    const effects = applyShotOutcome(target, 'p1', commit);
    expect(effects.collisionTargetId).toBe('e');
    expect(effects.healthAfter).toBe(2);
    expect(effects.healthReason).toBe('collision');
    expect(target.darts).toHaveLength(1); // 未钉板
    expect(target.players.p1.score).toBe(0);
    expect(target.players.p1.stats.collisions).toBe(1);
    expect(target.turn!.committed).toBe(1);
    expect(target.turn!.logicalElapsed).toBe(commit.impactElapsed);
    expect(target.rotation).toEqual(commit.rotationAfter);
  });

  it('eliminates the player when health reaches 0', () => {
    const ctx = makeCtx({
      darts: [{ id: 'e', ownerId: 'p2', boardAngle: 1.0, widthFactor: 1 }],
    });
    const probe = simulate(ctx, 1000, 0);
    const sim = simulate(ctx, 1000, 1.0 + (0 - probe.boardAngle));
    const commit = commitFromSimulation(ctx.turn!, sim, 1000);

    const target: ShotApplyTarget = {
      players: { p1: makePlayer('p1', { health: 1 }) },
      darts: [...ctx.darts],
      rotation: { ...BASE_ROTATION },
      turn: makeTurn(),
    };
    const effects = applyShotOutcome(target, 'p1', commit);
    expect(effects.eliminated).toBe(true);
    expect(target.players.p1.status).toBe('eliminated');
    expect(target.players.p1.health).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 安全命中与区域效果
// ---------------------------------------------------------------------------

describe('zone effects', () => {
  function zoneCtx(event: ActiveEvent) {
    return makeCtx({ event });
  }

  function shootIntoZone(ctx: ShotValidationContext, zoneAngle: number) {
    const probe = simulate(ctx, 1000, 0);
    return simulate(ctx, 1000, zoneAngle + (0 - probe.boardAngle));
  }

  it('heal zone restores health up to the cap', () => {
    const ctx = zoneCtx({ kind: 'heal_zone', zoneAngle: 1.0 });
    const sim = shootIntoZone(ctx, 1.0);
    expect(sim.outcome.zoneEffect).toEqual({ kind: 'heal' });

    const commit = commitFromSimulation(ctx.turn!, sim, 1000);
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: true });

    const target: ShotApplyTarget = {
      players: { p1: makePlayer('p1', { health: 2 }) },
      darts: [],
      rotation: { ...BASE_ROTATION },
      turn: makeTurn(),
    };
    const effects = applyShotOutcome(target, 'p1', commit);
    expect(effects.healthAfter).toBe(3);
    expect(effects.healthReason).toBe('zone');
  });

  it('slow zone re-anchors rotation to 0.7 speed, direction 1', () => {
    const ctx = zoneCtx({ kind: 'slow_zone', zoneAngle: 1.0 });
    ctx.rotation = { anchorAngle: 0.5, anchorElapsed: 0, speedFactor: 1.5, direction: -1 };
    const sim = shootIntoZone(ctx, 1.0);
    expect(sim.outcome.zoneEffect).toEqual({ kind: 'slow' });
    expect(sim.rotationAfter.speedFactor).toBe(0.7);
    expect(sim.rotationAfter.direction).toBe(1);

    const commit = commitFromSimulation(ctx.turn!, sim, 1000);
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: true });
  });

  it('wide / multishot zones set next-turn modifiers', () => {
    for (const [kind, effect, check] of [
      ['wide_zone', 'wide', (p: GamePlayer) => p.nextTurnWidth === 1.5],
      ['multishot_zone', 'multishot', (p: GamePlayer) => p.nextTurnShots === 3],
    ] as const) {
      const ctx = zoneCtx({ kind, zoneAngle: 1.0 });
      const sim = shootIntoZone(ctx, 1.0);
      expect(sim.outcome.zoneEffect).toEqual({ kind: effect });
      const commit = commitFromSimulation(ctx.turn!, sim, 1000);
      const target: ShotApplyTarget = {
        players: { p1: makePlayer('p1') },
        darts: [],
        rotation: { ...BASE_ROTATION },
        turn: makeTurn(),
      };
      applyShotOutcome(target, 'p1', commit);
      expect(check(target.players.p1)).toBe(true);
    }
  });

  it('shots outside the zone carry no effect', () => {
    const ctx = zoneCtx({ kind: 'heal_zone', zoneAngle: 1.0 });
    const sim = simulate(ctx, 1000, 3.0);
    expect(sim.outcome.zoneEffect).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 多镖回合（共享总时限、seq 严格递增）
// ---------------------------------------------------------------------------

describe('multi-shot turns', () => {
  it('chains shots on the same logical timeline', () => {
    const turn = makeTurn({ required: 3 });
    const target: ShotApplyTarget = {
      players: { p1: makePlayer('p1') },
      darts: [],
      rotation: { ...BASE_ROTATION },
      turn,
    };
    const ctx = makeCtx({ turn });

    // 第一镖：窗口 1000ms
    let sim = simulate(ctx, 1000, 0.3);
    let commit = commitFromSimulation(turn, sim, 1000);
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: true });
    applyShotOutcome(target, 'p1', commit);

    // 第二镖：窗口从第一镖命中时刻重新起算，fireElapsed 沿时间轴推进
    sim = simulateShot(
      { darts: target.darts, rotation: target.rotation, event: null, logicalElapsed: turn.logicalElapsed },
      { playerId: 'p1', seatAngle: 2.0, windowElapsed: 800, widthFactor: 1 },
    );
    commit = commitFromSimulation(turn, sim, 800);
    expect(commit.seq).toBe(2);
    expect(commit.fireElapsed).toBeCloseTo(commit.impactElapsed - SHOT_FLIGHT_MS);
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: true });
    applyShotOutcome(target, 'p1', commit);

    expect(turn.committed).toBe(2);
    expect(target.darts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 校验拒绝分支
// ---------------------------------------------------------------------------

describe('validateShotCommit rejections', () => {
  function validCommit(ctx: ShotValidationContext): ShotCommit {
    const sim = simulate(ctx, 1000, 0.3);
    return commitFromSimulation(ctx.turn!, sim, 1000);
  }

  it('rejects when no active turn', () => {
    const ctx = makeCtx({ phase: 'lobby' });
    const commit = validCommit(makeCtx());
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: false, reason: 'NO_ACTIVE_TURN' });
  });

  it('rejects commits from another player', () => {
    const ctx = makeCtx();
    expect(validateShotCommit(ctx, 'p2', validCommit(ctx))).toEqual({
      ok: false,
      reason: 'NOT_CURRENT_PLAYER',
    });
  });

  it('rejects stale turns', () => {
    const ctx = makeCtx();
    const commit = validCommit(ctx);
    expect(validateShotCommit(ctx, 'p1', { ...commit, revision: 99 })).toEqual({
      ok: false,
      reason: 'STALE_TURN',
    });
    expect(validateShotCommit(ctx, 'p1', { ...commit, turnId: 'turn-old' })).toEqual({
      ok: false,
      reason: 'STALE_TURN',
    });
  });

  it('silently ignores duplicate shotIds (idempotent)', () => {
    const ctx = makeCtx();
    const commit = validCommit(ctx);
    ctx.turn!.acceptedShotIds.push(commit.shotId);
    ctx.turn!.lastAcceptedSeq = 1;
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: false, reason: 'DUPLICATE' });
  });

  it('rejects out-of-order seq', () => {
    const ctx = makeCtx();
    const commit = { ...validCommit(ctx), seq: 2 };
    expect(validateShotCommit(ctx, 'p1', commit)).toEqual({ ok: false, reason: 'OUT_OF_ORDER' });
  });

  it('rejects bad timing', () => {
    const ctx = makeCtx();
    const good = validCommit(ctx);
    expect(validateShotCommit(ctx, 'p1', { ...good, windowElapsed: 16000 })).toEqual({
      ok: false,
      reason: 'BAD_TIMING',
    });
    expect(validateShotCommit(ctx, 'p1', { ...good, fireElapsed: good.fireElapsed + 10 })).toEqual({
      ok: false,
      reason: 'BAD_TIMING',
    });
    expect(
      validateShotCommit(ctx, 'p1', { ...good, impactElapsed: good.impactElapsed - 5 }),
    ).toEqual({ ok: false, reason: 'BAD_TIMING' });
  });

  it('rejects bad angle / width', () => {
    const ctx = makeCtx();
    const good = validCommit(ctx);
    expect(validateShotCommit(ctx, 'p1', { ...good, boardAngle: Math.PI * 2 })).toEqual({
      ok: false,
      reason: 'BAD_ANGLE',
    });
    expect(validateShotCommit(ctx, 'p1', { ...good, widthFactor: 2 })).toEqual({
      ok: false,
      reason: 'BAD_WIDTH',
    });
  });

  it('rejects bad rotation anchors', () => {
    const ctx = makeCtx();
    const good = validCommit(ctx);
    const wrongAnchor = {
      ...good,
      rotationAfter: { ...good.rotationAfter, anchorElapsed: good.impactElapsed + 100 },
    };
    expect(validateShotCommit(ctx, 'p1', wrongAnchor)).toEqual({
      ok: false,
      reason: 'BAD_ROTATION',
    });
    const wrongSpeed = {
      ...good,
      rotationAfter: { ...good.rotationAfter, speedFactor: 99 },
    };
    expect(validateShotCommit(ctx, 'p1', wrongSpeed)).toEqual({
      ok: false,
      reason: 'BAD_ROTATION',
    });
  });

  it('rejects fabricated collisions and scores', () => {
    const ctx = makeCtx();
    const good = validCommit(ctx);
    const ghostTarget = {
      ...good,
      outcome: { collision: { targetShotId: 'ghost' }, score: 0, zoneEffect: null },
    };
    expect(validateShotCommit(ctx, 'p1', ghostTarget)).toEqual({
      ok: false,
      reason: 'BAD_COLLISION_TARGET',
    });

    const ctxWithDart = makeCtx({
      darts: [{ id: 'e', ownerId: 'p2', boardAngle: 1.0, widthFactor: 1 }],
    });
    const good2 = validCommit(ctxWithDart);
    const lyingCollision = {
      ...good2,
      outcome: { collision: { targetShotId: 'e' }, score: 100, zoneEffect: null },
    };
    expect(validateShotCommit(ctxWithDart, 'p1', lyingCollision)).toEqual({
      ok: false,
      reason: 'BAD_COLLISION_RESULT',
    });
    const badScore = { ...good2, outcome: { collision: null, score: 15, zoneEffect: null } };
    expect(validateShotCommit(ctxWithDart, 'p1', badScore)).toEqual({
      ok: false,
      reason: 'BAD_SCORE',
    });
  });

  it('rejects zone effects inconsistent with the active event', () => {
    const ctx = makeCtx({ event: null });
    const good = validCommit(ctx);
    const fakeHeal = { ...good, outcome: { ...good.outcome, zoneEffect: { kind: 'heal' as const } } };
    expect(validateShotCommit(ctx, 'p1', fakeHeal)).toEqual({
      ok: false,
      reason: 'BAD_ZONE_EFFECT',
    });

    const wrongKind = makeCtx({ event: { kind: 'wide_zone', zoneAngle: 1.0 } });
    const good2 = validCommit(wrongKind);
    const mismatched = {
      ...good2,
      outcome: { ...good2.outcome, zoneEffect: { kind: 'heal' as const } },
    };
    expect(validateShotCommit(wrongKind, 'p1', mismatched)).toEqual({
      ok: false,
      reason: 'BAD_ZONE_EFFECT',
    });
  });
});

// ---------------------------------------------------------------------------
// 超时伤害
// ---------------------------------------------------------------------------

describe('timeoutDamage', () => {
  it('equals the number of unshot darts', () => {
    expect(timeoutDamage({ required: 1, committed: 0 })).toBe(1);
    expect(timeoutDamage({ required: 3, committed: 1 })).toBe(2);
    expect(timeoutDamage({ required: 3, committed: 3 })).toBe(0);
  });
});
