/**
 * LocalReplica 纯逻辑测试：跨回合远程飞行、同回合远程飞行、本地预测落地。
 * replica 无框架依赖（时间全部注入），可直接实例化。
 */

import { describe, expect, it } from 'vitest';
import { REBASE_MS, SHOT_FLIGHT_MS } from '../shared/constants';
import type { GamePlayer, GameState, ShotCommit, TurnSnapshot } from '../shared/protocol';
import { seatWorldAngle } from '../shared/rules';
import { simulateShot, validateShotCommit } from '../shared/shot';
import { LocalReplica, type ReplicaHooks } from './replica';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makePlayer(id: string, seat: number): GamePlayer {
  return {
    id,
    name: id,
    isHost: false,
    status: 'alive',
    connected: true,
    ready: true,
    seat,
    health: 3,
    score: 0,
    stats: { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 },
    nextTurnShots: 1,
    nextTurnWidth: 1,
  };
}

function makeTurn(overrides: Partial<TurnSnapshot>): TurnSnapshot {
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

function makeState(turn: TurnSnapshot, overrides: Partial<GameState> = {}): GameState {
  return {
    schema: 'dart-now@1',
    phase: 'playing',
    hostId: 'p1',
    players: { p1: makePlayer('p1', 0), p2: makePlayer('p2', 1) },
    activeOrder: ['p1', 'p2'],
    currentIndex: 0,
    turn,
    rotation: { anchorAngle: 0.3, anchorElapsed: 0, speedFactor: 1, direction: 1 },
    darts: [],
    event: null,
    lastEventKind: null,
    shotsSinceEvent: 0,
    nextEventAt: 3,
    eventDue: false,
    boardRevision: 0,
    turnRevision: turn.revision,
    winnerId: null,
    round: 1,
    ...overrides,
  };
}

function shootCommit(state: GameState, playerId: string, windowElapsed: number): ShotCommit {
  const turn = state.turn!;
  const sim = simulateShot(
    {
      darts: state.darts,
      rotation: state.rotation,
      event: state.event,
      logicalElapsed: turn.logicalElapsed,
    },
    {
      playerId,
      seatAngle: seatWorldAngle(state.players[playerId].seat, state.activeOrder.length),
      windowElapsed,
      widthFactor: turn.dartWidth,
    },
  );
  return {
    turnId: turn.id,
    revision: turn.revision,
    shotId: `${turn.id}-s1`,
    seq: 1,
    windowElapsed,
    fireElapsed: sim.fireElapsed,
    impactElapsed: sim.impactElapsed,
    boardAngle: sim.boardAngle,
    widthFactor: turn.dartWidth,
    rotationAfter: sim.rotationAfter,
    outcome: sim.outcome,
  };
}

function makeHooks(): ReplicaHooks & { accepted: unknown[] } {
  const accepted: unknown[] = [];
  return {
    accepted,
    acceptTurn: (p) => accepted.push(p),
    commitShot: () => {},
    commitTimeout: () => {},
    localShotLanded: () => {},
    remoteShotLanded: () => {},
    localTimeout: () => {},
  };
}

// ---------------------------------------------------------------------------
// 跨回合远程飞行（回归：曾污染新回合 logicalElapsed 导致 BAD_TIMING）
// ---------------------------------------------------------------------------

describe('cross-turn remote flight', () => {
  it('does not poison the new turn’s logical clock', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p2', () => 2, hooks);

    // turn-1（p1 的回合）快照 → p2 旁观
    const state1 = makeState(makeTurn({}));
    rep.handleSnapshot(state1, 0);

    // p1 的 shot-committed 事件先于快照到达 → 推入 remoteFlights
    const commit1 = shootCommit(state1, 'p1', 1500);
    rep.handleRemoteShot(commit1, 'p1', 50);

    // turn-2（p2 的回合）快照到达 → beginReplica（飞行中的镖被 deferredDarts 剔除）
    const state2 = makeState(makeTurn({ id: 'turn-2-p2', revision: 2, playerId: 'p2' }), {
      darts: [
        {
          id: commit1.shotId,
          ownerId: 'p1',
          boardAngle: commit1.boardAngle,
          widthFactor: 1,
        },
      ],
      currentIndex: 1,
    });
    rep.handleSnapshot(state2, 60);
    expect(rep.phase).toBe('aligning');

    // 重对齐虽满，但时钟零点映射在上一镖命中时刻（50+520=570）——激活被推迟到落定后
    rep.tick(60 + REBASE_MS + 10);
    expect(rep.phase).toBe('aligning');

    // 上一镖落定 → 激活（发送 accept_turn），且远程飞行按旧回合处理，不污染新回合时钟
    rep.tick(600);
    expect(rep.phase).toBe('active');
    expect(hooks.accepted).toHaveLength(1);
    expect(rep.turn?.logicalElapsed).toBe(0);
    // 镖应当补上（此前被 deferredDarts 剔除）
    expect(rep.darts.some((d) => d.id === commit1.shotId)).toBe(true);

    // p2 发射：commit 必须通过权威校验（此前会因 logicalElapsed 被污染而 BAD_TIMING）
    const now = 2000;
    expect(rep.shoot(now)).toBe(true);
    const commit2 = (rep as unknown as { flight: { commit: ShotCommit } }).flight.commit;
    // 窗口从时钟零点（570）起算
    expect(commit2.windowElapsed).toBeCloseTo(now - 570);
    const verdict = validateShotCommit(
      {
        phase: 'playing',
        turn: state2.turn,
        darts: state2.darts,
        rotation: state2.rotation,
        event: null,
      },
      'p2',
      commit2,
    );
    expect(verdict).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 同回合远程飞行：采用 commit 的时钟锚点（networking.md §7 的正规路径）
// ---------------------------------------------------------------------------

describe('same-turn remote flight', () => {
  it('adopts the commit’s clock anchors on landing', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p2', () => 2, hooks);

    const state1 = makeState(makeTurn({}));
    rep.handleSnapshot(state1, 0);

    const commit1 = shootCommit(state1, 'p1', 1500);
    rep.handleRemoteShot(commit1, 'p1', 50);
    rep.tick(50 + SHOT_FLIGHT_MS + 10);

    expect(rep.turn?.logicalElapsed).toBe(commit1.impactElapsed);
    expect(rep.turn?.committed).toBe(1);
    expect(rep.rotation).toEqual(commit1.rotationAfter);
    expect(rep.darts.some((d) => d.id === commit1.shotId)).toBe(true);

    // 快照随后到达（同一数据）：幂等合并，不重复钉镖
    const stateAfter = makeState(makeTurn({ committed: 1, logicalElapsed: commit1.impactElapsed, lastAcceptedSeq: 1, acceptedShotIds: [commit1.shotId] }), {
      darts: [
        { id: commit1.shotId, ownerId: 'p1', boardAngle: commit1.boardAngle, widthFactor: 1 },
      ],
      rotation: commit1.rotationAfter,
    });
    rep.handleSnapshot(stateAfter, 1000);
    expect(rep.darts.filter((d) => d.id === commit1.shotId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 本地预测落地与超时
// ---------------------------------------------------------------------------

describe('local prediction', () => {
  function activateMyTurn(rep: LocalReplica, state: GameState, now: number): void {
    rep.handleSnapshot(state, now);
    rep.tick(now + REBASE_MS + 10);
  }

  it('lands a predicted shot and produces a valid commit', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p2', () => 2, hooks);
    const state = makeState(makeTurn({ id: 'turn-1-p2', revision: 1, playerId: 'p2' }));
    activateMyTurn(rep, state, 0);
    expect(rep.phase).toBe('active');

    const fireAt = 1000;
    expect(rep.shoot(fireAt)).toBe(true);
    expect(rep.phase).toBe('flying');

    rep.tick(fireAt + SHOT_FLIGHT_MS + 10);
    expect(rep.phase).toBe('done'); // required=1，射满即结束
    expect(rep.darts).toHaveLength(1);
    expect(rep.players.p2.score).toBeGreaterThan(0);
  });

  it('times out locally and submits commit_timeout', () => {
    let timeoutCommit: unknown = null;
    const hooks = makeHooks();
    hooks.commitTimeout = (c) => {
      timeoutCommit = c;
    };
    const rep = new LocalReplica('p2', () => 2, hooks);
    const state = makeState(makeTurn({ id: 'turn-1-p2', revision: 1, playerId: 'p2' }));
    activateMyTurn(rep, state, 0);

    rep.tick(20000);
    expect(rep.phase).toBe('done');
    expect(timeoutCommit).not.toBeNull();
    expect(rep.players.p2.health).toBe(2); // 本地先行结算
  });
});
