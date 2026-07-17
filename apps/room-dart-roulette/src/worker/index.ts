import { defineRoom } from '@parti/worker-sdk';
import {
  WATCHDOG_MS,
  turnDurationForRound,
  validateShotCommit,
  type Dart,
  type EventKind,
  type GamePlayer,
  type GameState,
  type PlayerStatus,
  type RouletteEvent,
  type ShotCommit,
  type TimeoutCommit,
  type TurnSnapshot,
  type ZoneEffect,
} from '../shared';
import {
  TAU,
  ZONE_ARC,
  clampHealth,
  normalizeAngle,
  pickZoneAngle,
  rotationAngleAt,
  shuffle,
  timeoutDamage,
} from './logic';

type RoomContext = any;

const EVENT_KINDS: EventKind[] = ['speed_up', 'reverse', 'heal_zone', 'slow_zone', 'wide_zone', 'multishot_zone'];

function initialPlayer(player: { id: string; name: string; role: string }, status: PlayerStatus): GamePlayer {
  return {
    id: player.id,
    name: player.name || '无名镖客',
    isHost: player.role === 'host',
    connected: true,
    status,
    seat: -1,
    health: 3,
    score: 0,
    nextTurnShots: 1,
    nextTurnWidth: 1,
    stats: { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 },
  };
}

function randomEventThreshold(ctx: RoomContext): number {
  return 3 + Math.floor(ctx.random() * 3);
}

function aliveIds(state: GameState): string[] {
  return state.activeOrder.filter((id) => state.players[id]?.status === 'alive');
}

function scheduleWatchdog(ctx: RoomContext, turn: TurnSnapshot) {
  ctx.setTimer('dart-roulette:watchdog', WATCHDOG_MS, () => {
    const current = ctx.state.turn as TurnSnapshot | null;
    if (ctx.state.phase !== 'playing' || !current || current.id !== turn.id || current.revision !== turn.revision) return;
    applyTimeout(ctx, current, Math.max(current.durationMs, current.logicalElapsed), true);
  });
}

function finishIfNeeded(ctx: RoomContext): boolean {
  const alive = aliveIds(ctx.state);
  if (alive.length > 1) return false;
  ctx.clearTimer('dart-roulette:watchdog');
  ctx.state.phase = 'finished';
  ctx.state.turn = null;
  ctx.state.winnerId = alive[0] ?? null;
  ctx.state.boardRevision += 1;
  ctx.broadcast('roulette:game-over', { winnerId: ctx.state.winnerId });
  return true;
}

function eventCopy(kind: EventKind, id: string, zoneAngle: number | null): RouletteEvent {
  const definitions: Record<EventKind, [string, string]> = {
    speed_up: ['烈酒加速', '转盘速度提升至 1.5 倍'],
    reverse: ['酒馆反转', '转盘开始逆向旋转'],
    heal_zone: ['暖炉祝福', '命中奖励区可恢复 1 点血量'],
    slow_zone: ['冰镇时刻', '命中奖励区可让转盘减速'],
    wide_zone: ['笨重镖区', '命中者下一回合使用 1.5 倍宽镖'],
    multishot_zone: ['三镖罚单', '命中者下一回合须在总时限内发射 3 支'],
  };
  return {
    id,
    kind,
    label: definitions[kind][0],
    description: definitions[kind][1],
    zoneAngle,
    zoneArc: zoneAngle === null ? null : ZONE_ARC,
    activated: false,
  };
}

function triggerRandomEvent(ctx: RoomContext) {
  let kind = EVENT_KINDS[Math.floor(ctx.random() * EVENT_KINDS.length)];
  if (ctx.state.event?.kind === kind) kind = EVENT_KINDS[(EVENT_KINDS.indexOf(kind) + 1) % EVENT_KINDS.length];
  const angle = ctx.state.rotation.anchorAngle;
  ctx.state.rotation = {
    anchorAngle: angle,
    anchorElapsed: 0,
    speedFactor: kind === 'speed_up' ? 1.5 : 1,
    direction: kind === 'reverse' ? -1 : 1,
  };
  const isZone = kind.endsWith('_zone');
  const zoneAngle = isZone ? pickZoneAngle(ctx.state.darts, () => ctx.random()) : null;
  ctx.state.event = eventCopy(kind, `event-${ctx.state.boardRevision}-${Math.floor(ctx.random() * 1_000_000)}`, zoneAngle);
  ctx.state.shotsSinceEvent = 0;
  ctx.state.nextEventAt = randomEventThreshold(ctx);
  ctx.state.eventDue = false;
  ctx.broadcast('roulette:event', ctx.state.event);
}

function beginTurn(ctx: RoomContext, playerId: string) {
  const player = ctx.state.players[playerId] as GamePlayer;
  ctx.state.turnRevision += 1;
  const turn: TurnSnapshot = {
    id: `turn-${ctx.state.turnRevision}-${playerId}`,
    revision: ctx.state.turnRevision,
    playerId,
    required: player.nextTurnShots,
    durationMs: turnDurationForRound(ctx.state.round),
    committed: 0,
    dartWidth: player.nextTurnWidth,
    accepted: false,
    lastAcceptedSeq: 0,
    acceptedShotIds: [],
    logicalElapsed: 0,
  };
  player.nextTurnShots = 1;
  player.nextTurnWidth = 1;
  ctx.state.turn = turn;
  scheduleWatchdog(ctx, turn);
  ctx.broadcast('roulette:turn-granted', { turnId: turn.id, revision: turn.revision, playerId });
}

function advanceTurn(ctx: RoomContext) {
  if (finishIfNeeded(ctx)) return;
  const previousTurn = ctx.state.turn as TurnSnapshot | null;
  const endElapsed = previousTurn?.logicalElapsed ?? 0;
  const endAngle = rotationAngleAt(ctx.state.rotation, endElapsed);
  ctx.state.rotation = {
    anchorAngle: endAngle,
    anchorElapsed: 0,
    speedFactor: ctx.state.rotation.speedFactor,
    direction: ctx.state.rotation.direction,
  };
  if (ctx.state.eventDue) triggerRandomEvent(ctx);

  const order = ctx.state.activeOrder as string[];
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = (ctx.state.currentIndex + step) % order.length;
    if (ctx.state.players[order[candidate]]?.status === 'alive') {
      const wrapped = candidate <= ctx.state.currentIndex;
      if (wrapped) ctx.state.round += 1;
      ctx.state.currentIndex = candidate;
      beginTurn(ctx, order[candidate]);
      if (wrapped) {
        ctx.broadcast('roulette:round-started', {
          round: ctx.state.round,
          durationMs: turnDurationForRound(ctx.state.round),
        });
      }
      return;
    }
  }
}

function reject(ctx: RoomContext, playerId: string, reason: string) {
  const turn = ctx.state.turn as TurnSnapshot | null;
  ctx.send(playerId, 'roulette:commit-rejected', {
    turnId: turn?.id ?? null,
    revision: turn?.revision ?? null,
    reason,
    boardRevision: ctx.state.boardRevision,
  });
}

function validateShot(ctx: RoomContext, playerId: string, commit: ShotCommit): string | null {
  const turn = ctx.state.turn as TurnSnapshot | null;
  if (!turn || ctx.state.phase !== 'playing') return 'NO_ACTIVE_TURN';
  if (!commit || typeof commit !== 'object') return 'BAD_PAYLOAD';
  return validateShotCommit({
    commit,
    turn,
    playerId,
    rotation: ctx.state.rotation,
    darts: ctx.state.darts,
    event: ctx.state.event,
  });
}

function applyZoneResult(ctx: RoomContext, player: GamePlayer, effect: ZoneEffect) {
  if (!effect) return;
  if (ctx.state.event) ctx.state.event.activated = true;
  if (effect === 'heal') player.health = clampHealth(player.health + 1);
  if (effect === 'wide') player.nextTurnWidth = 1.5;
  if (effect === 'multishot') player.nextTurnShots = 3;
}

function applyShot(ctx: RoomContext, commit: ShotCommit) {
  const turn = ctx.state.turn as TurnSnapshot;
  const player = ctx.state.players[commit.playerId] as GamePlayer;
  const collided = commit.outcome.collisionTargetId !== null;
  const healthBefore = player.health;
  player.stats.shots += 1;
  if (collided) {
    player.health = clampHealth(player.health - 1);
    player.stats.collisions += 1;
    if (player.health === 0) player.status = 'eliminated';
  } else {
    ctx.state.darts.push({
      id: commit.shotId,
      ownerId: player.id,
      boardAngle: normalizeAngle(commit.boardAngle),
      widthFactor: commit.widthFactor,
      score: commit.outcome.score,
    });
    player.score += commit.outcome.score;
    player.stats.safeHits += 1;
    applyZoneResult(ctx, player, commit.outcome.zoneEffect);
  }

  ctx.state.rotation = commit.rotationAfter;
  turn.committed += 1;
  turn.lastAcceptedSeq = commit.seq;
  turn.acceptedShotIds.push(commit.shotId);
  turn.logicalElapsed = commit.impactElapsed;
  ctx.state.shotsSinceEvent += 1;
  if (ctx.state.shotsSinceEvent >= ctx.state.nextEventAt) ctx.state.eventDue = true;
  ctx.state.boardRevision += 1;
  ctx.broadcast('roulette:shot-committed', commit);
  if (commit.outcome.zoneEffect) {
    ctx.broadcast('roulette:zone-triggered', {
      playerId: player.id,
      effect: commit.outcome.zoneEffect,
      eventKind: ctx.state.event?.kind ?? null,
    });
  }
  if (player.health !== healthBefore) {
    ctx.broadcast('roulette:health-changed', {
      playerId: player.id,
      delta: player.health - healthBefore,
      health: player.health,
      reason: collided ? 'collision' : 'zone',
    });
  }
  if (player.status === 'eliminated') {
    ctx.broadcast('roulette:player-eliminated', { playerId: player.id });
  }

  if (player.status !== 'alive' || turn.committed >= turn.required) {
    ctx.clearTimer('dart-roulette:watchdog');
    advanceTurn(ctx);
  }
}

function applyTimeout(ctx: RoomContext, turn: TurnSnapshot, finalElapsed: number, watchdog: boolean) {
  const player = ctx.state.players[turn.playerId] as GamePlayer;
  const healthBefore = player.health;
  const damage = timeoutDamage(turn.required, turn.committed);
  player.health = clampHealth(player.health - damage);
  player.stats.timeouts += 1;
  if (player.health === 0) player.status = 'eliminated';
  turn.logicalElapsed = finalElapsed;
  ctx.state.rotation = {
    anchorAngle: rotationAngleAt(ctx.state.rotation, finalElapsed),
    anchorElapsed: finalElapsed,
    speedFactor: ctx.state.rotation.speedFactor,
    direction: ctx.state.rotation.direction,
  };
  ctx.state.boardRevision += 1;
  ctx.broadcast('roulette:timeout', { playerId: player.id, damage, watchdog });
  if (player.health !== healthBefore) {
    ctx.broadcast('roulette:health-changed', {
      playerId: player.id,
      delta: player.health - healthBefore,
      health: player.health,
      reason: watchdog ? 'connection-timeout' : 'turn-timeout',
    });
  }
  if (player.status === 'eliminated') {
    ctx.broadcast('roulette:player-eliminated', { playerId: player.id });
  }
  ctx.clearTimer('dart-roulette:watchdog');
  advanceTurn(ctx);
}

const room = defineRoom({
  meta: { name: '飞镖轮盘', minPlayers: 2, maxPlayers: 8 },

  initialState(): GameState {
    return {
      schema: 'dart-roulette@2',
      phase: 'lobby',
      hostId: null,
      players: {},
      activeOrder: [],
      currentIndex: 0,
      turn: null,
      rotation: { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 },
      darts: [],
      event: null,
      shotsSinceEvent: 0,
      nextEventAt: 4,
      eventDue: false,
      boardRevision: 0,
      turnRevision: 0,
      winnerId: null,
      round: 1,
    };
  },

  onRestore(ctx: RoomContext) {
    if (ctx.state.phase === 'playing' && ctx.state.turn) scheduleWatchdog(ctx, ctx.state.turn);
  },

  onJoin(ctx: RoomContext, player: { id: string; name: string; role: string }) {
    ctx.state.players[player.id] = initialPlayer(player, ctx.state.phase === 'lobby' ? 'waiting' : 'queued');
    if (player.role === 'host') ctx.state.hostId = player.id;
  },

  onReconnect(ctx: RoomContext, player: { id: string; name: string; role: string }) {
    const existing = ctx.state.players[player.id] as GamePlayer | undefined;
    if (existing) {
      existing.connected = true;
      existing.name = player.name || existing.name;
    } else {
      ctx.state.players[player.id] = initialPlayer(player, ctx.state.phase === 'lobby' ? 'waiting' : 'queued');
    }
  },

  onLeave(ctx: RoomContext, player: { id: string }) {
    const existing = ctx.state.players[player.id] as GamePlayer | undefined;
    if (!existing) return;
    if (ctx.state.phase === 'playing' && existing.status === 'alive') existing.connected = false;
    else delete ctx.state.players[player.id];
  },

  actions: {
    start_game(ctx: RoomContext, { player }: { player: { id: string } }) {
      if (ctx.state.phase !== 'lobby' || player.id !== ctx.state.hostId) return;
      const candidates = Object.values(ctx.state.players as Record<string, GamePlayer>)
        .filter((candidate) => candidate.connected && candidate.status === 'waiting');
      if (candidates.length < 2 || candidates.length > 8) return;
      const order = shuffle(candidates.map((candidate) => candidate.id), () => ctx.random());
      for (const candidate of Object.values(ctx.state.players as Record<string, GamePlayer>)) {
        const seat = order.indexOf(candidate.id);
        candidate.status = seat >= 0 ? 'alive' : 'queued';
        candidate.seat = seat;
        candidate.health = 3;
        candidate.score = 0;
        candidate.nextTurnShots = 1;
        candidate.nextTurnWidth = 1;
        candidate.stats = { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 };
      }
      ctx.state.phase = 'playing';
      ctx.state.activeOrder = order;
      ctx.state.currentIndex = 0;
      ctx.state.rotation = { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 };
      ctx.state.darts = [];
      ctx.state.event = null;
      ctx.state.shotsSinceEvent = 0;
      ctx.state.nextEventAt = randomEventThreshold(ctx);
      ctx.state.eventDue = false;
      ctx.state.boardRevision += 1;
      ctx.state.winnerId = null;
      ctx.state.round = 1;
      beginTurn(ctx, order[0]);
      ctx.broadcast('roulette:game-started', { order });
    },

    accept_turn(ctx: RoomContext, { player, payload }: { player: { id: string }; payload: { turnId?: string; revision?: number } }) {
      const turn = ctx.state.turn as TurnSnapshot | null;
      if (!turn || turn.playerId !== player.id || payload?.turnId !== turn.id || payload?.revision !== turn.revision) return;
      turn.accepted = true;
      scheduleWatchdog(ctx, turn);
    },

    commit_shot(ctx: RoomContext, { player, payload }: { player: { id: string }; payload: ShotCommit }) {
      const reason = validateShot(ctx, player.id, payload);
      if (reason === 'DUPLICATE') return;
      if (reason) {
        reject(ctx, player.id, reason);
        return;
      }
      applyShot(ctx, payload);
    },

    commit_timeout(ctx: RoomContext, { player, payload }: { player: { id: string }; payload: TimeoutCommit }) {
      const turn = ctx.state.turn as TurnSnapshot | null;
      if (!turn || !payload || turn.playerId !== player.id || payload.turnId !== turn.id || payload.revision !== turn.revision) {
        reject(ctx, player.id, 'STALE_TURN');
        return;
      }
      if (payload.seq !== turn.lastAcceptedSeq + 1 || !Number.isFinite(payload.finalElapsed) || !Number.isFinite(payload.rotationEndAngle)) {
        reject(ctx, player.id, 'BAD_TIMEOUT');
        return;
      }
      const expected = Math.max(turn.durationMs, turn.logicalElapsed);
      if (Math.abs(payload.finalElapsed - expected) > 0.5 || payload.rotationEndAngle < 0 || payload.rotationEndAngle >= TAU) {
        reject(ctx, player.id, 'BAD_TIMEOUT');
        return;
      }
      applyTimeout(ctx, turn, payload.finalElapsed, false);
    },

    return_to_lobby(ctx: RoomContext, { player }: { player: { id: string } }) {
      if (ctx.state.phase !== 'finished' || player.id !== ctx.state.hostId) return;
      for (const [id, candidate] of Object.entries(ctx.state.players as Record<string, GamePlayer>)) {
        if (!candidate.connected) {
          delete ctx.state.players[id];
          continue;
        }
        candidate.status = 'waiting';
        candidate.seat = -1;
        candidate.health = 3;
        candidate.nextTurnShots = 1;
        candidate.nextTurnWidth = 1;
      }
      ctx.state.phase = 'lobby';
      ctx.state.activeOrder = [];
      ctx.state.currentIndex = 0;
      ctx.state.turn = null;
      ctx.state.darts = [];
      ctx.state.event = null;
      ctx.state.eventDue = false;
      ctx.state.winnerId = null;
      ctx.state.boardRevision += 1;
    },
  },
});

export default room;
