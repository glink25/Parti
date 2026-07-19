/**
 * LocalReplica 纯逻辑测试：跨回合远程飞行、同回合远程飞行、本地预测落地。
 * replica 无框架依赖（时间全部注入），可直接实例化。
 */

import { describe, expect, it } from 'vitest';
import { REBASE_MS, SHOT_FLIGHT_MS } from '../shared/constants';
import type { GamePlayer, GameState, ShotCommit, TurnSnapshot } from '../shared/protocol';
import { angularDistance, rotationAngleAt, seatWorldAngle } from '../shared/rules';
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

function makeHooks(): ReplicaHooks & { accepted: unknown[]; commitShots: ShotCommit[] } {
  const accepted: unknown[] = [];
  const commitShots: ShotCommit[] = [];
  return {
    accepted,
    commitShots,
    acceptTurn: (p) => accepted.push(p),
    commitShot: (c) => commitShots.push(c),
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

    // turn-2（p2 的回合）快照到达 → beginReplica（飞行中的镖被 deferredDarts 剔除）。
    // 快照已携带新世界（事件加速了转速），但上一镖还没落定
    const newEvent = { kind: 'speed_up' as const, zoneAngle: null };
    const state2 = makeState(makeTurn({ id: 'turn-2-p2', revision: 2, playerId: 'p2' }), {
      darts: [
        {
          id: commit1.shotId,
          ownerId: 'p1',
          boardAngle: commit1.boardAngle,
          widthFactor: 1,
        },
      ],
      rotation: {
        anchorAngle: commit1.rotationAfter.anchorAngle, // 角度连续
        anchorElapsed: 0,
        speedFactor: 1.5, // 事件加速
        direction: 1,
      },
      event: newEvent,
      currentIndex: 1,
    });
    rep.handleSnapshot(state2, 60);
    expect(rep.phase).toBe('aligning');

    // 落定前：世界保持原样（旧转速、旧区域），快照里的新世界只进暂存
    expect(rep.rotation).toEqual(commit1.rotationAfter);
    expect(rep.event).toBeNull();

    // 重对齐虽满，但时钟零点映射在上一镖命中时刻（50+520=570）——激活被推迟到落定后
    rep.tick(60 + REBASE_MS + 10);
    expect(rep.phase).toBe('aligning');
    expect(rep.rotation).toEqual(commit1.rotationAfter);
    expect(rep.event).toBeNull();

    // 上一镖落定 → 激活（发送 accept_turn），新世界此刻才切换；旧飞行不污染新回合时钟
    rep.tick(600);
    expect(rep.phase).toBe('active');
    expect(hooks.accepted).toHaveLength(1);
    expect(rep.rotation).toEqual(state2.rotation);
    expect(rep.event).toEqual(newEvent);
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


// ---------------------------------------------------------------------------
// 超时转换（回归：角度求解曾混用新旧状态，时钟偏移数秒）
// ---------------------------------------------------------------------------

describe('timeout transition clock continuity', () => {
  it('maps the new turn’s epoch to the timeout wall time, not seconds off', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p2', () => 2, hooks);

    // turn-1（p1 的回合），p2 旁观
    const state1 = makeState(makeTurn({}));
    rep.handleSnapshot(state1, 0);

    // p1 超时：Worker 把 rotation 归一到 durationMs 终点，快照在超时后 50ms 到达
    const now = 15050;
    const endAngle = rotationAngleAt(state1.rotation, 15000);
    const state2 = makeState(makeTurn({ id: 'turn-2-p2', revision: 2, playerId: 'p2' }), {
      rotation: { anchorAngle: endAngle, anchorElapsed: 0, speedFactor: 1, direction: 1 },
      currentIndex: 1,
    });
    rep.handleSnapshot(state2, now);

    // 时钟零点必须 ≈ 超时墙钟时刻（旧实现可偏出 ±4000ms）
    const logical = rep.logicalNow(now);
    expect(logical).toBeGreaterThanOrEqual(0);
    expect(logical).toBeLessThan(300);

    // 角度连续：新公式角 ≈ 旧回合外推角（按最短弧比较）
    const prevVisual = rotationAngleAt(state1.rotation, now);
    expect(angularDistance(rep.visualAngle(now), prevVisual)).toBeLessThan(0.1);

    // 激活不被异常推迟：重对齐满即可发射
    rep.tick(now + REBASE_MS + 10);
    expect(rep.phase).toBe('active');
    expect(hooks.accepted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 多镖回合（回归：同回合快照曾在镖落定前快进时钟，先跳后回）
// ---------------------------------------------------------------------------

describe('multi-shot turn sync', () => {
  it('observer: same-turn snapshot does not fast-forward the clock mid-flight', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p2', () => 2, hooks);

    const state1 = makeState(makeTurn({ required: 3 }));
    rep.handleSnapshot(state1, 0);

    // p1 的第 1 镖：事件先于快照到达
    const commit1 = shootCommit(state1, 'p1', 1500);
    rep.handleRemoteShot(commit1, 'p1', 50);

    // Worker 接受后的同回合快照（镖还要 ~470ms 才落定）
    const midTurn = makeTurn({ required: 3 });
    midTurn.committed = 1;
    midTurn.lastAcceptedSeq = 1;
    midTurn.acceptedShotIds = [commit1.shotId];
    midTurn.logicalElapsed = commit1.impactElapsed;
    const state2 = makeState(midTurn, {
      rotation: commit1.rotationAfter,
      darts: [{ id: commit1.shotId, ownerId: 'p1', boardAngle: commit1.boardAngle, widthFactor: 1 }],
    });
    rep.handleSnapshot(state2, 60);

    // 进度数值推进了，但时钟不得快进（旧实现会立刻跳到 impactElapsed）
    expect(rep.turn?.logicalElapsed).toBe(commit1.impactElapsed);
    expect(rep.logicalNow(60)).toBeLessThan(1000);
    expect(rep.rotation).toEqual(state1.rotation);
    // 镖仍在飞，不得钉板
    expect(rep.darts).toHaveLength(0);

    // 落定时刻：锚点此刻才采用，时钟连续（误差为 tick 粒度级）
    rep.tick(600);
    expect(rep.darts).toHaveLength(1);
    expect(rep.rotation).toEqual(commit1.rotationAfter);
    expect(Math.abs(rep.logicalNow(600) - commit1.impactElapsed)).toBeLessThan(100);
  });

  it('shooter: snapshot-confirmed shots land without double counting (3-shot turn completes)', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p1', () => 2, hooks);

    // 我自己的三镖回合
    const state1 = makeState(makeTurn({ required: 3 }));
    rep.handleSnapshot(state1, 0);
    rep.tick(REBASE_MS + 10);
    expect(rep.phase).toBe('active');

    // 每支镖都模拟「Worker accept 快于飞行」：快照先于落定确认该镖
    const dartIds: string[] = [];
    const darts: GameState['darts'] = [];
    let rotation = state1.rotation;
    let fireAt = 1000;
    for (let i = 1; i <= 3; i += 1) {
      expect(rep.shoot(fireAt)).toBe(true);
      const commit = hooks.commitShots[i - 1];
      dartIds.push(commit.shotId);
      darts.push({
        id: commit.shotId,
        ownerId: 'p1',
        boardAngle: commit.boardAngle,
        widthFactor: 1,
      });
      rotation = commit.rotationAfter;

      // Worker 接受后的同回合快照（镖还在飞）
      const midTurn = makeTurn({ required: 3 });
      midTurn.committed = i;
      midTurn.lastAcceptedSeq = i;
      midTurn.acceptedShotIds = [...dartIds];
      midTurn.logicalElapsed = commit.impactElapsed;
      rep.handleSnapshot(
        makeState(midTurn, { rotation, darts: darts.map((d) => ({ ...d })) }),
        fireAt + 50,
      );

      // 落定：committed 不得重复计数（旧实现会 +2，第三镖前回合就被误判 done）
      rep.tick(fireAt + SHOT_FLIGHT_MS + 10);
      expect(rep.turn?.committed).toBe(i);
      expect(rep.darts.filter((d) => d.id === commit.shotId)).toHaveLength(1);

      fireAt += SHOT_FLIGHT_MS + 500;
    }

    // 三镖射满：回合才结束，等待权威快照推进到下一玩家
    expect(rep.phase).toBe('done');
    expect(rep.darts).toHaveLength(3);
  });

  it('shooter: early same-turn snapshot does not corrupt the clock, second commit validates', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p1', () => 2, hooks);

    // 我自己的三镖回合
    const state1 = makeState(makeTurn({ required: 3 }));
    rep.handleSnapshot(state1, 0);
    rep.tick(REBASE_MS + 10);
    expect(rep.phase).toBe('active');

    // 第 1 镖：1500ms 发射
    expect(rep.shoot(1500)).toBe(true);
    expect(hooks.commitShots).toHaveLength(1);
    const commit1 = hooks.commitShots[0];

    // Worker 抢先接受的同回合快照（本地镖还在飞）
    const midTurn = makeTurn({ required: 3 });
    midTurn.committed = 1;
    midTurn.lastAcceptedSeq = 1;
    midTurn.acceptedShotIds = [commit1.shotId];
    midTurn.logicalElapsed = commit1.impactElapsed;
    const state2 = makeState(midTurn, {
      rotation: commit1.rotationAfter,
      darts: [{ id: commit1.shotId, ownerId: 'p1', boardAngle: commit1.boardAngle, widthFactor: 1 }],
    });
    rep.handleSnapshot(state2, 1550);

    // 时钟不被污染：仍在飞，logicalNow 不突进
    expect(rep.phase).toBe('flying');
    expect(rep.logicalNow(1550)).toBeLessThan(1900);

    // 落定：镖钉板（与快照去重），进入下一支
    rep.tick(commit1.impactElapsed + 10);
    expect(rep.phase).toBe('active');
    expect(rep.darts).toHaveLength(1);

    // 第 2 镖：commit 必须通过权威校验
    expect(rep.shoot(3000)).toBe(true);
    expect(hooks.commitShots).toHaveLength(2);
    const commit2 = hooks.commitShots[1];
    expect(commit2.seq).toBe(2);
    const verdict = validateShotCommit(
      {
        phase: 'playing',
        turn: state2.turn,
        darts: state2.darts,
        rotation: state2.rotation,
        event: null,
      },
      'p1',
      commit2,
    );
    expect(verdict).toEqual({ ok: true });
  });
});


// ---------------------------------------------------------------------------
// 下一出手方视角（回归：aligning 期间时钟曾被冻结，标靶瞬间倒拨数十度）
// ---------------------------------------------------------------------------

describe('next shooter view during incoming flight', () => {
  it('keeps the board continuous while aligning (no freeze on the interim clock)', () => {
    const hooks = makeHooks();
    const rep = new LocalReplica('p2', () => 2, hooks);

    // turn-1（p1 的回合），p2 旁观；墙钟与逻辑时间轴对齐（P0 = 0）
    const state1 = makeState(makeTurn({}));
    rep.handleSnapshot(state1, 0);

    // p1 在逻辑 1500ms 发射（墙钟 ≈ 1500+λ），事件 1550 到达，快照 1560 到达
    const commit1 = shootCommit(state1, 'p1', 1500);
    rep.handleRemoteShot(commit1, 'p1', 1550);
    const state2 = makeState(makeTurn({ id: 'turn-2-p2', revision: 2, playerId: 'p2' }), {
      darts: [
        {
          id: commit1.shotId,
          ownerId: 'p1',
          boardAngle: commit1.boardAngle,
          widthFactor: 1,
        },
      ],
      rotation: {
        anchorAngle: commit1.rotationAfter.anchorAngle,
        anchorElapsed: 0,
        speedFactor: 1,
        direction: 1,
      },
      currentIndex: 1,
    });
    rep.handleSnapshot(state2, 1560);
    expect(rep.phase).toBe('aligning');

    // 镖落定前的每一帧，画面必须与旧时间轴外推连续（误差为事件延迟量级）
    // 旧实现：aligning 冻结 logicalNow=0 → rotationAngleAt(rotationAfter, 0)，倒拨约 90°
    for (const t of [1560, 1700, 1900, 2050]) {
      const expected = rotationAngleAt(state1.rotation, t);
      expect(angularDistance(rep.visualAngle(t), expected)).toBeLessThan(0.1);
    }

    // 落定后激活，时钟从零点起走
    rep.tick(2080);
    expect(rep.phase).toBe('active');
  });
});
