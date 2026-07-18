/**
 * 客户端入口：DOM 获取、parti 接线、帧循环启动。
 * 逻辑推进（replica.tick）同时由 rAF 与 250ms setInterval 驱动——
 * 后台标签页 rAF 暂停时本地超时判定不会停摆（见 docs/refactor-plan.md §4.5）。
 */

import { BASE_ROTATION_MS, TAU } from '../shared/constants';
import type { GameState } from '../shared/protocol';
import { seatWorldAngle } from '../shared/rules';
import { audio } from './audio';
import { Feedback } from './feedback';
import { createNet } from './net';
import { Hud } from './render/hud';
import { Overlay } from './render/overlay';
import { Scene, seatColor, type FlightView } from './render/scene';
import { LocalReplica, type ReplicaHooks } from './replica';
import './style.css';

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

let booted = false;

// 首个 onState 回调时 playerId 已就绪（见 docs/client-api.md）。
// 注意：onState 在已有 state 时会同步触发回调，此时订阅返回值尚未赋值——
// 回调内不得引用订阅句柄本身（TDZ），用 booted 守卫代替退订。
parti.onState((raw) => {
  if (booted) return;
  booted = true;
  boot(raw as GameState);
});

function boot(initial: GameState): void {
  const myId = parti.playerId;
  if (!myId) throw new Error('parti.playerId unavailable at boot');

  const now = () => performance.now();
  let latest: GameState = initial;

  const scene = new Scene(must('scene') as HTMLCanvasElement);
  const feedback = new Feedback(must('feedback-root'));
  const liveRegion = must('live-region');

  const replicaHooks: ReplicaHooks = {
    acceptTurn: (p) => void parti.action('accept_turn', p),
    commitShot: (c) => void parti.action('commit_shot', c),
    commitTimeout: (c) => void parti.action('commit_timeout', c),
    localShotLanded: (commit, effects) => {
      const world = commit.boardAngle + commit.rotationAfter.anchorAngle;
      if (effects.collisionTargetId) {
        scene.addPopup(world, '碰撞！', 'bad');
        audio.play('collision');
      } else {
        scene.addPopup(world, `+${effects.scoreDelta}`, 'score');
        audio.play('hit');
        if (effects.scoreDelta >= 60) audio.play('score', { pitch: 1 + effects.scoreDelta / 200 });
        if (effects.zoneEffect?.kind === 'heal') audio.play('heal');
      }
      if (effects.eliminated) feedback.push('生命耗尽，被淘汰…', 'bad');
    },
    remoteShotLanded: (commit) => {
      const world = commit.boardAngle + commit.rotationAfter.anchorAngle;
      if (commit.outcome.collision) {
        scene.addPopup(world, '碰撞', 'bad');
        audio.play('collision');
      } else {
        scene.addPopup(world, `+${commit.outcome.score}`, 'score');
        audio.play('hit');
      }
    },
    localTimeout: (damage) => {
      feedback.push(`超时 −${damage}♥`, 'bad');
      audio.play('timeout');
    },
  };

  const replica = new LocalReplica(myId, () => latest.activeOrder.length, replicaHooks);

  const fire = (): void => {
    audio.unlock();
    if (replica.shoot(now())) audio.play('shoot');
  };

  const hud = new Hud(must('hud-root'), fire);
  const overlay = new Overlay(must('overlay-root'), {
    onToggleReady: () => void parti.action('toggle_ready'),
    onStartGame: () => void parti.action('start_game'),
    onReturnToLobby: () => void parti.action('return_to_lobby'),
  });

  const nameOf = (id: string | null | undefined): string =>
    (id && latest.players[id]?.name) || '…';

  let announcedTurnId: string | null = null;
  const refresh = (state: GameState): void => {
    latest = state;
    overlay.update(state, myId);
    const turn = state.turn;
    if (turn && turn.id !== announcedTurnId) {
      announcedTurnId = turn.id;
      liveRegion.textContent =
        turn.playerId === myId ? '轮到你出手了' : `轮到 ${nameOf(turn.playerId)} 出手`;
    }
  };

  createNet({
    replica,
    feedback,
    audio,
    myId: () => myId,
    playerName: (id) => nameOf(id),
    now,
    latestState: () => latest,
    onState: refresh,
  });
  replica.handleSnapshot(initial, now());
  refresh(initial);

  // 输入
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      fire();
    }
  });
  window.addEventListener('pointerdown', () => audio.unlock());
  window.addEventListener('resize', () => scene.resize());

  // 帧循环：渲染 + 逻辑 tick
  const frame = (): void => {
    const t = now();
    replica.tick(t);
    feedback.tick(t);
    renderScene(t);
    renderHud(t);
    requestAnimationFrame(frame);
  };

  const seatAngleOf = (playerId: string): number => {
    const p = latest.players[playerId];
    return seatWorldAngle(p?.seat ?? 0, Math.max(1, latest.activeOrder.length));
  };

  const renderScene = (t: number): void => {
    const playing = latest.phase === 'playing' && replica.turn !== null;
    const flights: FlightView[] = [];
    if (playing) {
      const lf = replica.flightProgress(t);
      if (lf) {
        flights.push({
          fromAngle: seatAngleOf(myId),
          toAngle: lf.flight.commit.boardAngle + lf.flight.commit.rotationAfter.anchorAngle,
          t: lf.t,
          color: seatColor(latest.players[myId]?.seat ?? 0),
        });
      }
      for (const rf of replica.remoteFlightProgress(t)) {
        flights.push({
          fromAngle: seatAngleOf(rf.flight.playerId),
          toAngle: rf.flight.commit.boardAngle + rf.flight.commit.rotationAfter.anchorAngle,
          t: rf.t,
          color: seatColor(latest.players[rf.flight.playerId]?.seat ?? 0),
        });
      }
    }
    // 视角：自己的座位固定在屏幕正下方，飞镖始终从脚下发出
    const seatCount = Math.max(1, latest.activeOrder.length);
    const mySeat = latest.players[myId]?.seat ?? -1;
    const viewOffset = mySeat >= 0 ? Math.PI - seatWorldAngle(mySeat, seatCount) : 0;
    scene.render({
      now: t,
      // 非对局阶段：标靶缓慢空转（纯装饰）
      visualAngle: playing
        ? replica.visualAngle(t)
        : ((t / BASE_ROTATION_MS) * TAU) % TAU,
      viewOffset,
      aimPreview:
        replica.canShoot() && mySeat >= 0
          ? { angle: seatWorldAngle(mySeat, seatCount), color: seatColor(mySeat) }
          : null,
      darts: playing ? replica.darts : latest.darts,
      seatedPlayers: latest.activeOrder
        .map((id) => latest.players[id])
        .filter((p) => p !== undefined),
      currentPlayerId: latest.turn?.playerId ?? null,
      event: playing ? replica.event : latest.event,
      myId,
      flights,
    });
  };

  const renderHud = (t: number): void => {
    const playing = latest.phase === 'playing';
    const progress = replica.shotsProgress();
    hud.update({
      playing,
      canShoot: replica.canShoot(),
      timerMs: replica.turn ? replica.timerRemaining(t) : null,
      durationMs: replica.turn?.durationMs ?? latest.turn?.durationMs ?? 1,
      committed: progress.committed,
      required: progress.required,
      round: latest.round,
      event: playing ? replica.event : latest.event,
      isMyTurn: latest.turn?.playerId === myId,
      currentPlayerName: nameOf(latest.turn?.playerId),
      phase: replica.phase,
    });
  };

  requestAnimationFrame(frame);
  // 后台标签页 rAF 暂停时的逻辑兜底（超时判定、飞行落地）
  setInterval(() => replica.tick(now()), 250);

  parti.ready();
}
