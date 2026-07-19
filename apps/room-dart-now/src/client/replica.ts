/**
 * LocalReplica：客户端本地副本与预测，显式状态机。
 *
 * 阶段迁移只发生在本类暴露的四个入口：
 *   handleSnapshot / handleRejected / handleRemoteShot / tick / shoot
 * 渲染层只读视图方法，不直接改 replica（见 docs/refactor-plan.md §4.2）。
 *
 * 延迟无关：出手方本地用 simulateShot 确定性仿真并先行应用结果，
 * commit 自带逻辑时间轴坐标，Worker 校验坐标自洽性而非到达时刻。
 */

import { BASE_ROTATION_MS, REBASE_MS, SHOT_FLIGHT_MS, TAU } from '../shared/constants';
import type {
  AcceptTurnPayload,
  ActiveEvent,
  BoardDart,
  GamePlayer,
  GameState,
  Rotation,
  ShotCommit,
  TimeoutCommit,
  TurnSnapshot,
} from '../shared/protocol';
import { clampHealth, rotationAngleAt, seatWorldAngle } from '../shared/rules';
import {
  applyShotOutcome,
  simulateShot,
  timeoutDamage,
  type AppliedShotEffects,
} from '../shared/shot';

export type ReplicaPhase =
  | 'aligning' // 新回合：画面重对齐中，时钟未启动
  | 'active' // 我的回合：可发射
  | 'observing' // 旁观他人回合
  | 'flying' // 我的镖在飞（本地预测已提交）
  | 'done' // 我的回合已结束（射满/淘汰/超时），等待快照推进
  | 'recovering'; // commit 被拒：放弃本地预测，按权威快照重建并重对齐

export interface RemoteFlight {
  commit: ShotCommit;
  playerId: string;
  startWall: number;
  impactWall: number;
}

export interface LocalFlight {
  commit: ShotCommit;
  startWall: number;
  impactWall: number;
}

/** replica 对外副作用（网络提交与 UI 反馈），由 net/main 注入 */
export interface ReplicaHooks {
  acceptTurn(payload: AcceptTurnPayload): void;
  commitShot(commit: ShotCommit): void;
  commitTimeout(commit: TimeoutCommit): void;
  /** 本地镖落地（预测生效），用于弹分/音效 */
  localShotLanded(commit: ShotCommit, effects: AppliedShotEffects): void;
  /** 远程镖落地，用于旁观者弹分/音效 */
  remoteShotLanded(commit: ShotCommit, playerId: string): void;
  /** 本地判定超时（预测扣血），用于 UI 反馈 */
  localTimeout(damage: number): void;
  /**
   * 世界（转速/方向/区域）已就绪：上一镖落定、新世界切换完成，
   * 或快照即时采用（无延迟情形）。用于把排队的事件提示延迟到此刻弹出。
   */
  worldSettled?(): void;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export class LocalReplica {
  phase: ReplicaPhase = 'observing';

  turn: TurnSnapshot | null = null;
  darts: BoardDart[] = [];
  rotation: Rotation = { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 };
  event: ActiveEvent | null = null;
  players: Record<string, GamePlayer> = {};

  /** 逻辑时钟：logicalNow = logicalEpoch + (now − wallEpoch) */
  private wallEpoch = 0;
  private logicalEpoch = 0;

  /** 重对齐：从 rebaseFrom 平滑过渡到公式角 */
  private rebasing = false;
  private rebaseFrom = 0;
  private rebaseStart = 0;

  private flight: LocalFlight | null = null;
  private readonly remoteFlights: RemoteFlight[] = [];
  /** 本地已落地但尚未被快照确认的镖 */
  private readonly predictedIds = new Set<string>();
  private timedOut = false;
  /**
   * 快照先于上一镖落定到达时，新世界（转速/方向/区域）暂存于此，
   * 等到落定时刻（wallEpoch）才切换——玩家激活发射时世界必须已稳定
   */
  private pendingRotation: Rotation | null = null;
  private pendingEvent: ActiveEvent | null = null;

  constructor(
    private readonly myId: string,
    private readonly seatCount: () => number,
    private readonly hooks: ReplicaHooks,
  ) {}

  // -------------------------------------------------------------------------
  // 入口 1：权威快照
  // -------------------------------------------------------------------------

  handleSnapshot(state: GameState, now: number): void {
    this.players = state.players;
    if (state.phase !== 'playing' || !state.turn) {
      this.clear();
      return;
    }
    const snapTurn = state.turn;
    if (!this.turn || this.turn.id !== snapTurn.id) {
      const isMyTurn = snapTurn.playerId === this.myId && this.isAlive();
      this.beginReplica(state, now, isMyTurn, false);
      return;
    }

    // 同一回合：合并权威字段。逻辑进度只前进不后退（本地预测可能领先）
    this.turn.committed = snapTurn.committed;
    this.turn.lastAcceptedSeq = snapTurn.lastAcceptedSeq;
    this.turn.acceptedShotIds = [...snapTurn.acceptedShotIds];
    if (snapTurn.logicalElapsed > this.turn.logicalElapsed) {
      this.turn.logicalElapsed = snapTurn.logicalElapsed;
      // 有镖在飞（本地或远程）时不得采用新锚点——快照在 Worker 接受 commit 时
      // 发出，镖还有几百毫秒才落定，提前快进时钟会让角度先跳后回；
      // 锚点统一由 landLocalFlight / completeRemoteFlights 在落定时刻采用
      if (!this.flight && this.remoteFlights.length === 0) {
        this.rotation = state.rotation;
        this.logicalEpoch = snapTurn.logicalElapsed;
        this.wallEpoch = now;
      }
    }
    // 世界切换未落地前，快照里的新区域只进暂存
    if (this.pendingRotation) this.pendingEvent = state.event;
    else this.event = state.event;
    for (const id of [...this.predictedIds]) {
      if (state.darts.some((d) => d.id === id)) this.predictedIds.delete(id);
    }
    this.mergeDarts(state.darts);
  }

  // -------------------------------------------------------------------------
  // 入口 2：commit 被拒——放弃本地预测，按权威快照重建
  // -------------------------------------------------------------------------

  handleRejected(state: GameState, now: number): void {
    this.players = state.players;
    if (state.phase !== 'playing' || !state.turn) {
      this.clear();
      return;
    }
    const isMyTurn = state.turn.playerId === this.myId && this.isAlive();
    this.beginReplica(state, now, isMyTurn, true);
  }

  // -------------------------------------------------------------------------
  // 入口 3：远程镖事件（旁观者飞行动画）
  // -------------------------------------------------------------------------

  handleRemoteShot(commit: ShotCommit, playerId: string, now: number): void {
    if (playerId === this.myId) return; // 自己的回显：本地已预测
    if (!this.turn || commit.turnId !== this.turn.id) return;
    if (this.darts.some((d) => d.id === commit.shotId)) return;
    if (this.remoteFlights.some((f) => f.commit.shotId === commit.shotId)) return;
    this.remoteFlights.push({
      commit,
      playerId,
      startWall: now,
      impactWall: now + SHOT_FLIGHT_MS,
    });
  }

  // -------------------------------------------------------------------------
  // 入口 4：帧/定时 tick（可注入时间，可单测）
  // -------------------------------------------------------------------------

  tick(now: number): void {
    if (!this.turn) return;

    // 上一镖落定 → 切换新世界（转速/方向/区域），逻辑时钟从时间轴零点起走
    if (this.pendingRotation && now >= this.wallEpoch) {
      this.rotation = this.pendingRotation;
      this.event = this.pendingEvent;
      this.pendingRotation = null;
      this.pendingEvent = null;
      this.logicalEpoch = this.turn.logicalElapsed;
      this.hooks.worldSettled?.();
    }

    // 重对齐完成且时钟到达时间轴零点（上一镖落定）→ 激活
    if (
      (this.phase === 'aligning' || this.phase === 'recovering') &&
      now - this.rebaseStart >= REBASE_MS &&
      now >= this.wallEpoch
    ) {
      this.activate();
    }
    if (this.rebasing && now - this.rebaseStart >= REBASE_MS) this.rebasing = false;

    // 本地飞行落地 → 预测应用
    if (this.phase === 'flying' && this.flight && now >= this.flight.impactWall) {
      this.landLocalFlight(now);
    }

    this.completeRemoteFlights(now);

    // 超时本地先判（飞行中不判，由 commit 结算）
    if (this.phase === 'active' && !this.timedOut) {
      const logicalNow = this.logicalEpoch + (now - this.wallEpoch);
      if (logicalNow >= this.turn.durationMs) this.timeoutLocal();
    }
  }

  // -------------------------------------------------------------------------
  // 入口 5：按下发射
  // -------------------------------------------------------------------------

  shoot(now: number): boolean {
    if (this.phase !== 'active' || !this.turn) return false;
    const me = this.players[this.myId];
    if (!me) return false;
    const turn = this.turn;
    const windowElapsed = now - this.wallEpoch;
    if (windowElapsed < 0 || windowElapsed > turn.durationMs) return false; // 超时由 tick 判

    const sim = simulateShot(
      {
        darts: this.darts,
        rotation: this.rotation,
        event: this.event,
        logicalElapsed: turn.logicalElapsed,
      },
      {
        playerId: this.myId,
        seatAngle: seatWorldAngle(me.seat, Math.max(1, this.seatCount())),
        windowElapsed,
        widthFactor: turn.dartWidth,
      },
    );

    const commit: ShotCommit = {
      turnId: turn.id,
      revision: turn.revision,
      shotId: `${turn.id}-s${turn.lastAcceptedSeq + 1}-${Math.random().toString(36).slice(2, 8)}`,
      seq: turn.lastAcceptedSeq + 1,
      windowElapsed,
      fireElapsed: sim.fireElapsed,
      impactElapsed: sim.impactElapsed,
      boardAngle: sim.boardAngle,
      widthFactor: turn.dartWidth,
      rotationAfter: sim.rotationAfter,
      outcome: sim.outcome,
    };

    this.flight = { commit, startWall: now, impactWall: now + SHOT_FLIGHT_MS };
    this.phase = 'flying';
    this.hooks.commitShot(commit);
    return true;
  }

  // -------------------------------------------------------------------------
  // 视图（只读）
  // -------------------------------------------------------------------------

  /** 当前应呈现的逻辑时刻 */
  logicalNow(now: number): number {
    if (!this.turn) return 0;
    // 时钟全程连续运行（零点已映射到正确的墙钟时刻）——
    // 切不可在 aligning 期间冻结：freeze 会用 turn.logicalElapsed 求值
    // 上一镖的 rotationAfter（锚定在 impactElapsed），把标靶瞬间倒拨数十度
    return this.logicalEpoch + (now - this.wallEpoch);
  }

  /** 标靶视觉转角（含重对齐过渡） */
  visualAngle(now: number): number {
    const formula = rotationAngleAt(this.rotation, this.logicalNow(now));
    if (!this.rebasing) return formula;
    const t = smoothstep((now - this.rebaseStart) / REBASE_MS);
    // 沿最短弧插值
    let delta = formula - this.rebaseFrom;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return this.rebaseFrom + delta * t;
  }

  /** 剩余时间；重对齐期间返回 null（UI 显示 ···） */
  timerRemaining(now: number): number | null {
    if (!this.turn) return null;
    if (this.phase === 'aligning' || this.phase === 'recovering') return null;
    // 时钟零点映射到上一镖命中时刻，激活前 logicalNow 可能为负——钳到 durationMs
    return Math.min(this.turn.durationMs, Math.max(0, this.turn.durationMs - this.logicalNow(now)));
  }

  canShoot(): boolean {
    return this.phase === 'active';
  }

  shotsProgress(): { committed: number; required: number } {
    return {
      committed: this.turn?.committed ?? 0,
      required: this.turn?.required ?? 1,
    };
  }

  flightProgress(now: number): { flight: LocalFlight; t: number } | null {
    if (this.phase !== 'flying' || !this.flight) return null;
    return {
      flight: this.flight,
      t: Math.min(1, (now - this.flight.startWall) / SHOT_FLIGHT_MS),
    };
  }

  remoteFlightProgress(now: number): { flight: RemoteFlight; t: number }[] {
    return this.remoteFlights.map((f) => ({
      flight: f,
      t: Math.min(1, (now - f.startWall) / SHOT_FLIGHT_MS),
    }));
  }

  // -------------------------------------------------------------------------
  // 内部迁移
  // -------------------------------------------------------------------------

  private clear(): void {
    this.turn = null;
    this.darts = [];
    this.flight = null;
    this.remoteFlights.length = 0;
    this.predictedIds.clear();
    this.timedOut = false;
    this.rebasing = false;
    this.pendingRotation = null;
    this.pendingEvent = null;
    this.phase = 'observing';
  }

  private beginReplica(state: GameState, now: number, isMyTurn: boolean, recovering: boolean): void {
    // 先记录切换前的视觉角（重对齐起点 + 时钟求解输入），再替换任何状态
    const prevAngle = this.turn ? this.visualAngle(now) : null;
    const snapTurn = state.turn!;
    if (this.flight) {
      if (recovering) {
        // 预测被否：这支镖从未被权威接受，整支作废
        this.flight = null;
      } else {
        // 自己的镖还在飞就先按远程镖收尾，避免飞行动画被快照截断
        this.remoteFlights.push({ commit: this.flight.commit, playerId: this.myId, startWall: this.flight.startWall, impactWall: this.flight.impactWall });
        this.flight = null;
      }
    }

    // deferredDarts：仍在飞行的镖从快照里剔除，避免「钉着+飞着」同时出现
    const flyingIds = new Set(this.remoteFlights.map((f) => f.commit.shotId));
    const nextDarts = state.darts.filter((d) => !flyingIds.has(d.id)).map((d) => ({ ...d }));

    // 时钟决策（在覆盖 rotation/turn 之前完成）：
    // 快照先于上一镖落定到达时，落定前世界必须保持原样——用上一镖的 rotationAfter
    // 按旧转速外推，新世界（转速/方向/区域）暂存，落定时刻在 tick 里统一切换。
    const latestFlight = this.latestPendingFlight();
    const deferred = latestFlight !== null && latestFlight.impactWall > now;
    const epochWall = deferred
      ? latestFlight.impactWall
      : this.computeEpochWall(now, prevAngle, state.rotation, snapTurn.logicalElapsed);

    this.turn = { ...snapTurn, acceptedShotIds: [...snapTurn.acceptedShotIds] };
    this.predictedIds.clear();
    this.timedOut = false;
    this.darts = nextDarts;
    this.wallEpoch = epochWall;

    if (deferred && latestFlight) {
      this.pendingRotation = state.rotation;
      this.pendingEvent = state.event;
      // this.event 保持旧世界
      this.rotation = latestFlight.commit.rotationAfter;
      this.logicalEpoch = latestFlight.commit.impactElapsed;
    } else {
      this.pendingRotation = null;
      this.pendingEvent = null;
      this.rotation = state.rotation;
      this.event = state.event;
      this.logicalEpoch = snapTurn.logicalElapsed;
      // 世界即时就绪（无延迟的情形），通知 UI 冲刷排队的事件提示
      this.hooks.worldSettled?.();
    }

    this.rebaseFrom = prevAngle ?? rotationAngleAt(this.rotation, this.logicalNow(now));
    this.rebasing = true;
    this.rebaseStart = now;

    this.phase = isMyTurn ? (recovering ? 'recovering' : 'aligning') : 'observing';
  }

  /** 仍在飞的最晚一支镖（旧回合收尾），无则 null */
  private latestPendingFlight(): RemoteFlight | null {
    let latest: RemoteFlight | null = null;
    for (const f of this.remoteFlights) {
      if (!latest || f.impactWall > latest.impactWall) latest = f;
    }
    return latest;
  }

  /**
   * 求新时间轴 newLogicalElapsed 对应的墙钟时刻 P，使标靶角度跨回合连续：
   * - 有仍在飞的镖（旧回合收尾）：P = 最新命中墙钟时刻（精确）；
   * - 无飞行（超时/恢复）：以「切换前的旧视觉角 prevAngle」按角度连续性求解（最短弧）；
   * - 首个回合（prevAngle 为 null）：P = now。
   *
   * prevAngle 必须在覆盖 this.rotation/this.turn 之前捕获——否则求解会
   * 把新 rotation 与旧时钟混算，超时转换下 P 可偏出数秒。
   */
  private computeEpochWall(
    now: number,
    prevAngle: number | null,
    newRotation: Rotation,
    newLogicalElapsed: number,
  ): number {
    let latest = -Infinity;
    for (const f of this.remoteFlights) latest = Math.max(latest, f.impactWall);
    if (Number.isFinite(latest)) return latest;
    if (prevAngle === null) return now;

    let delta = prevAngle - newRotation.anchorAngle;
    while (delta > Math.PI) delta -= TAU;
    while (delta < -Math.PI) delta += TAU;
    const rate = (TAU / BASE_ROTATION_MS) * newRotation.speedFactor * newRotation.direction;
    // rotationAngleAt(newRotation, newLogicalElapsed + (now − P)) = prevAngle 的解
    return now + (newLogicalElapsed - newRotation.anchorElapsed) - delta / rate;
  }

  private activate(): void {
    this.rebasing = false;
    if (this.turn && this.turn.playerId === this.myId && this.isAlive()) {
      // 不再重置时钟：wallEpoch 已映射到时间轴零点（上一镖命中/角度连续点），
      // 窗口与画面共用同一时钟，瞄准才与仿真一致
      this.phase = 'active';
      this.hooks.acceptTurn({ turnId: this.turn.id, revision: this.turn.revision });
    } else {
      this.phase = 'observing';
    }
  }

  private landLocalFlight(now: number): void {
    if (!this.flight || !this.turn) return;
    const { commit } = this.flight;
    this.flight = null;

    // 快照可能已抢先确认这支镖（Worker accept 快于 520ms 飞行）：committed/计分/
    // 扣血已随快照并入，再次 applyShotOutcome 会重复计数——多镖回合会因此提前
    // 进入 done，剩余的镖无法出手、回合卡死（回归：三镖回合只能射两镖）
    const alreadyConfirmed = this.turn.acceptedShotIds.includes(commit.shotId);
    let effects: AppliedShotEffects;
    if (alreadyConfirmed) {
      if (!commit.outcome.collision && !this.darts.some((d) => d.id === commit.shotId)) {
        this.darts.push({
          id: commit.shotId,
          ownerId: this.myId,
          boardAngle: commit.boardAngle,
          widthFactor: commit.widthFactor,
        });
      }
      this.rotation = { ...commit.rotationAfter };
      const me = this.players[this.myId];
      effects = {
        playerId: this.myId,
        collisionTargetId: commit.outcome.collision?.targetShotId ?? null,
        scoreDelta: commit.outcome.collision ? 0 : commit.outcome.score,
        zoneEffect: commit.outcome.zoneEffect,
        healthBefore: me?.health ?? 0,
        healthAfter: me?.health ?? 0,
        healthReason: null,
        eliminated: me?.status === 'eliminated',
      };
    } else {
      const target = {
        players: this.players,
        darts: this.darts,
        rotation: this.rotation,
        turn: this.turn,
      };
      effects = applyShotOutcome(target, this.myId, commit);
      this.rotation = target.rotation;
      if (!commit.outcome.collision) this.predictedIds.add(commit.shotId);
    }
    // 多镖回合里快照可能已抢先包含这支镖（accept 快于 520ms 飞行）——按 id 去重
    const seen = new Set<string>();
    this.darts = this.darts.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    // 命中后窗口重置，逻辑时钟从 impactElapsed 继续走
    this.wallEpoch = now;
    this.logicalEpoch = this.turn.logicalElapsed;

    this.hooks.localShotLanded(commit, effects);
    this.phase = effects.eliminated || this.turn.committed >= this.turn.required ? 'done' : 'active';
  }

  private timeoutLocal(): void {
    if (!this.turn) return;
    this.timedOut = true;
    const turn = this.turn;
    const damage = timeoutDamage(turn);
    const finalElapsed = Math.max(turn.durationMs, turn.logicalElapsed);
    const rotationEndAngle = rotationAngleAt(this.rotation, finalElapsed);

    // 本地先行结算（预测），权威快照随后确认
    const me = this.players[this.myId];
    if (me && damage > 0) me.health = clampHealth(me.health - damage);
    this.phase = 'done';
    this.hooks.localTimeout(damage);
    this.hooks.commitTimeout({
      turnId: turn.id,
      revision: turn.revision,
      finalElapsed,
      rotationEndAngle,
    });
  }

  private completeRemoteFlights(now: number): void {
    for (let i = this.remoteFlights.length - 1; i >= 0; i -= 1) {
      const f = this.remoteFlights[i];
      if (now < f.impactWall) continue;
      this.remoteFlights.splice(i, 1);
      // 幂等：快照可能已包含这支镖
      if (!f.commit.outcome.collision && !this.darts.some((d) => d.id === f.commit.shotId)) {
        this.darts.push({
          id: f.commit.shotId,
          ownerId: f.playerId,
          boardAngle: f.commit.boardAngle,
          widthFactor: f.commit.widthFactor,
        });
      }
      // 只有属于「当前回合」的飞行才能采用其时钟锚点与进度——
      // 事件先于快照到达，跨回合的飞行携带的是旧时间轴坐标，
      // 若据此推进 turn.logicalElapsed 会污染新回合（BAD_TIMING 且无法自愈）
      if (this.turn && f.commit.turnId === this.turn.id) {
        this.rotation = f.commit.rotationAfter;
        this.logicalEpoch = f.commit.impactElapsed;
        this.wallEpoch = now;
        this.turn.logicalElapsed = Math.max(this.turn.logicalElapsed, f.commit.impactElapsed);
        this.turn.committed = Math.max(this.turn.committed, f.commit.seq);
      }
      this.hooks.remoteShotLanded(f.commit, f.playerId);
    }
  }

  private mergeDarts(snapDarts: BoardDart[]): void {
    // 仍在飞行的镖（含本地在飞）从快照里剔除，避免「钉着+飞着」同时出现
    const flyingIds = new Set(this.remoteFlights.map((f) => f.commit.shotId));
    if (this.flight) flyingIds.add(this.flight.commit.shotId);
    const snapIds = new Set(snapDarts.map((d) => d.id));
    const base = snapDarts.filter((d) => !flyingIds.has(d.id)).map((d) => ({ ...d }));
    const localOnly = this.darts.filter((d) => this.predictedIds.has(d.id) && !snapIds.has(d.id));
    this.darts = [...base, ...localOnly];
  }

  private isAlive(): boolean {
    return this.players[this.myId]?.status === 'alive';
  }
}
