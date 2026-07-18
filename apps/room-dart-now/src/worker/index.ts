/**
 * 权威房间逻辑（defineRoom）：生命周期 + actions 编排。
 * 流程细节在 turns.ts / events.ts；纯规则在 shared/。
 */

import { defineRoom } from '@parti/worker-sdk';
import { MAX_PLAYERS, MAX_HEALTH, MIN_PLAYERS, TAU } from '../shared/constants';
import { lobbyReadiness } from '../shared/lobby';
import {
  STATE_SCHEMA,
  type AcceptTurnPayload,
  type GamePlayer,
  type GameState,
  type LobbyErrorReason,
  type ShotCommit,
  type TimeoutCommit,
} from '../shared/protocol';
import { shuffled } from '../shared/rules';
import { validateShotCommit } from '../shared/shot';
import { asCtx, type ActionEvent, type RoomPlayer, type WorkerContext } from './context';
import { rollEventInterval } from './events';
import {
  applyAcceptedShot,
  applyTimeout,
  armWatchdog,
  beginTurn,
  isTimeoutCommitValid,
  resetGameData,
} from './turns';

// ---------------------------------------------------------------------------
// 玩家记录
// ---------------------------------------------------------------------------

function newPlayer(player: RoomPlayer, status: GamePlayer['status']): GamePlayer {
  return {
    id: player.id,
    name: player.name,
    isHost: player.role === 'host',
    status,
    connected: true,
    ready: false,
    seat: -1,
    health: MAX_HEALTH,
    score: 0,
    stats: { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 },
    nextTurnShots: 1,
    nextTurnWidth: 1,
  };
}

function lobbyError(ctx: WorkerContext, playerId: string, reason: LobbyErrorReason): void {
  ctx.send(playerId, 'dart:lobby-error', { reason });
}

// ---------------------------------------------------------------------------
// 对局开始 / 回大厅
// ---------------------------------------------------------------------------

function startGame(ctx: WorkerContext, player: RoomPlayer): void {
  const { state } = ctx;
  if (state.phase !== 'lobby') return lobbyError(ctx, player.id, 'bad-phase');
  if (player.id !== state.hostId) return lobbyError(ctx, player.id, 'not-host');

  const waiting = Object.values(state.players).filter((p) => p.status === 'waiting');
  const readiness = lobbyReadiness(waiting);
  if (!readiness.canStart) return lobbyError(ctx, player.id, readiness.reason ?? 'bad-phase');

  // 洗牌定座位与出手顺序
  const order = shuffled(
    waiting.map((p) => p.id),
    ctx.random,
  );
  state.activeOrder = order;
  order.forEach((id, seat) => {
    const p = state.players[id];
    p.status = 'alive';
    p.seat = seat;
    resetGameData(p);
  });

  state.currentIndex = 0;
  state.round = 1;
  state.turn = null;
  state.darts = [];
  state.rotation = {
    anchorAngle: ctx.random() * TAU,
    anchorElapsed: 0,
    speedFactor: 1,
    direction: 1,
  };
  state.event = null;
  state.lastEventKind = null;
  state.shotsSinceEvent = 0;
  state.nextEventAt = rollEventInterval(ctx.random);
  state.eventDue = false;
  state.winnerId = null;
  state.boardRevision += 1;
  state.phase = 'playing';

  ctx.broadcast('dart:game-started', { activeOrder: order });
  beginTurn(ctx, order[0]);
}

function returnToLobby(ctx: WorkerContext, player: RoomPlayer): void {
  const { state } = ctx;
  if (state.phase !== 'finished') return lobbyError(ctx, player.id, 'not-finished');
  if (player.id !== state.hostId) return lobbyError(ctx, player.id, 'not-host');

  // 离线玩家此时被清除，其余回大厅候场
  for (const p of Object.values(state.players)) {
    if (!p.connected) {
      delete state.players[p.id];
    } else {
      p.status = 'waiting';
      p.ready = false;
      p.seat = -1;
      resetGameData(p);
    }
  }
  state.phase = 'lobby';
  state.activeOrder = [];
  state.currentIndex = 0;
  state.turn = null;
  state.darts = [];
  state.event = null;
  state.lastEventKind = null;
  state.eventDue = false;
  state.winnerId = null;
  state.round = 1;
  state.boardRevision += 1;
}

// ---------------------------------------------------------------------------
// defineRoom
// ---------------------------------------------------------------------------

export default defineRoom({
  meta: { name: '飞镖时刻', minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS },

  initialState(): GameState {
    return {
      schema: STATE_SCHEMA,
      phase: 'lobby',
      hostId: null,
      players: {},
      activeOrder: [],
      currentIndex: 0,
      turn: null,
      rotation: { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 },
      darts: [],
      event: null,
      lastEventKind: null,
      shotsSinceEvent: 0,
      nextEventAt: rollEventInterval(Math.random),
      eventDue: false,
      boardRevision: 0,
      turnRevision: 0,
      winnerId: null,
      round: 1,
    };
  },

  onCreate(ctxRaw) {
    const ctx = asCtx(ctxRaw);
    ctx.state.hostId = ctx.host.id;
  },

  // 房主刷新恢复：重新武装看门狗，避免回合永久悬停
  onRestore(ctxRaw) {
    const ctx = asCtx(ctxRaw);
    if (ctx.state.phase === 'playing' && ctx.state.turn) armWatchdog(ctx);
  },

  onJoin(ctxRaw, player) {
    const ctx = asCtx(ctxRaw);
    const { state } = ctx;
    if (!state.hostId || player.role === 'host') state.hostId = ctx.host.id;
    if (state.players[player.id]) return;
    state.players[player.id] = newPlayer(player, state.phase === 'lobby' ? 'waiting' : 'queued');
  },

  onLeave(ctxRaw, player) {
    const ctx = asCtx(ctxRaw);
    const { state } = ctx;
    const p = state.players[player.id];
    if (!p) return;
    if (state.phase === 'playing') {
      // 保留席位与数据；其回合由看门狗/超时机制兜底，不阻塞对局
      p.connected = false;
      p.ready = false;
    } else {
      delete state.players[player.id];
    }
  },

  onReconnect(ctxRaw, player) {
    const ctx = asCtx(ctxRaw);
    const { state } = ctx;
    if (!state.hostId || player.role === 'host') state.hostId = ctx.host.id;
    const p = state.players[player.id];
    if (p) {
      // 恢复原身份与席位
      p.connected = true;
      p.name = player.name;
    } else {
      // 无记录（曾在 lobby/finished 被清除）：按新加入处理
      state.players[player.id] = newPlayer(player, state.phase === 'lobby' ? 'waiting' : 'queued');
    }
  },

  actions: {
    toggle_ready(ctxRaw, { player }: ActionEvent) {
      const ctx = asCtx(ctxRaw);
      const { state } = ctx;
      if (state.phase !== 'lobby') return lobbyError(ctx, player.id, 'bad-phase');
      const p = state.players[player.id];
      if (!p || p.status !== 'waiting') return lobbyError(ctx, player.id, 'unknown-player');
      p.ready = !p.ready;
    },

    start_game(ctxRaw, { player }: ActionEvent) {
      startGame(asCtx(ctxRaw), player);
    },

    accept_turn(ctxRaw, { player, payload }: ActionEvent) {
      const ctx = asCtx(ctxRaw);
      const turn = ctx.state.turn;
      const p = payload as AcceptTurnPayload | null;
      // 不匹配的 accept 静默忽略（过期/重复握手无副作用）
      if (!turn || !p) return;
      if (player.id !== turn.playerId) return;
      if (p.turnId !== turn.id || p.revision !== turn.revision) return;
      armWatchdog(ctx);
    },

    commit_shot(ctxRaw, { player, payload }: ActionEvent) {
      const ctx = asCtx(ctxRaw);
      const commit = payload as ShotCommit;
      const result = validateShotCommit(ctx.state, player.id, commit);
      if (!result.ok) {
        // 幂等：网络重发/双击静默忽略
        if (result.reason === 'DUPLICATE') return;
        ctx.send(player.id, 'dart:commit-rejected', {
          turnId: commit?.turnId ?? '',
          revision: commit?.revision ?? 0,
          reason: result.reason,
          boardRevision: ctx.state.boardRevision,
        });
        return;
      }
      applyAcceptedShot(ctx, player.id, commit);
    },

    commit_timeout(ctxRaw, { player, payload }: ActionEvent) {
      const ctx = asCtx(ctxRaw);
      const commit = payload as TimeoutCommit;
      // 不合法的超时提交静默忽略（看门狗兜底结算）
      if (!isTimeoutCommitValid(ctx.state, player.id, commit)) return;
      applyTimeout(ctx, false);
    },

    return_to_lobby(ctxRaw, { player }: ActionEvent) {
      returnToLobby(asCtx(ctxRaw), player);
    },
  },
});
