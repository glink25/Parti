import { defineRoom } from '@parti/worker-sdk';
import {
  TAU,
  ZONE_ARC,
  boardAngleFromWorld,
  clampHealth,
  findCollision,
  isInsideZone,
  pickZoneAngle,
  rotationAngleAt,
  scoreSafeDart,
  shuffle,
  timeoutDamage,
  type Rotation,
} from './logic';

type Phase = 'lobby' | 'playing' | 'finished';
type PlayerStatus = 'waiting' | 'queued' | 'alive' | 'eliminated';
type EventKind = 'speed_up' | 'reverse' | 'heal_zone' | 'slow_zone' | 'wide_zone' | 'multishot_zone';

type GamePlayer = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  status: PlayerStatus;
  seat: number;
  health: number;
  score: number;
  nextTurnShots: number;
  nextTurnWidth: number;
  stats: { shots: number; safeHits: number; collisions: number; timeouts: number };
};

type Dart = {
  id: string;
  ownerId: string;
  boardAngle: number;
  widthFactor: number;
  score: number;
};

type RouletteEvent = {
  id: string;
  kind: EventKind;
  label: string;
  description: string;
  zoneAngle: number | null;
  zoneArc: number | null;
  triggeredAt: number;
  activated: boolean;
};

type Turn = {
  id: string;
  playerId: string;
  required: number;
  fired: number;
  dartWidth: number;
  startedAt: number;
  deadline: number;
};

type PendingShot = {
  id: string;
  playerId: string;
  worldAngle: number;
  boardAngle: number;
  widthFactor: number;
  firedAt: number;
  impactAt: number;
};

type GameState = {
  schema: 'dart-roulette@1';
  phase: Phase;
  hostId: string | null;
  serverNow: number;
  players: Record<string, GamePlayer>;
  activeOrder: string[];
  currentIndex: number;
  turn: Turn | null;
  rotation: Rotation;
  darts: Dart[];
  event: RouletteEvent | null;
  shotsSinceEvent: number;
  nextEventAt: number;
  pendingShot: PendingShot | null;
  winnerId: string | null;
  finishedAt: number | null;
  round: number;
};

type RoomContext = any;

const TURN_MS = 10_000;
const SHOT_FLIGHT_MS = 520;
const EVENT_KINDS: EventKind[] = [
  'speed_up',
  'reverse',
  'heal_zone',
  'slow_zone',
  'wide_zone',
  'multishot_zone',
];

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

function touch(ctx: RoomContext, at = ctx.now()) {
  ctx.state.serverNow = at;
}

function randomEventThreshold(ctx: RoomContext): number {
  return 3 + Math.floor(ctx.random() * 3);
}

function setRotation(ctx: RoomContext, at: number, speedFactor: number, direction: 1 | -1) {
  const currentAngle = rotationAngleAt(ctx.state.rotation, at);
  ctx.state.rotation = { anchorAngle: currentAngle, anchorAt: at, speedFactor, direction };
}

function aliveIds(state: GameState): string[] {
  return state.activeOrder.filter((id) => state.players[id]?.status === 'alive');
}

function finishIfNeeded(ctx: RoomContext, at: number): boolean {
  const alive = aliveIds(ctx.state);
  if (alive.length > 1) return false;
  ctx.clearTimer('dart-roulette:turn');
  ctx.clearTimer('dart-roulette:shot');
  ctx.state.phase = 'finished';
  ctx.state.turn = null;
  ctx.state.pendingShot = null;
  ctx.state.winnerId = alive[0] ?? null;
  ctx.state.finishedAt = at;
  touch(ctx, at);
  ctx.broadcast('roulette:game-over', { winnerId: ctx.state.winnerId });
  return true;
}

function scheduleTurnTimeout(ctx: RoomContext, turn: Turn, delay = TURN_MS) {
  ctx.setTimer('dart-roulette:turn', Math.max(0, delay), () => {
    if (ctx.state.phase !== 'playing' || ctx.state.turn?.id !== turn.id || ctx.state.pendingShot) return;
    resolveTimeout(ctx, turn.id);
  });
}

function beginTurn(ctx: RoomContext, playerId: string, at: number) {
  const player = ctx.state.players[playerId] as GamePlayer;
  const required = player.nextTurnShots;
  const dartWidth = player.nextTurnWidth;
  player.nextTurnShots = 1;
  player.nextTurnWidth = 1;
  const turn: Turn = {
    id: `turn-${at}-${playerId}-${ctx.state.round}`,
    playerId,
    required,
    fired: 0,
    dartWidth,
    startedAt: at,
    deadline: at + TURN_MS,
  };
  ctx.state.turn = turn;
  touch(ctx, at);
  scheduleTurnTimeout(ctx, turn);
  ctx.broadcast('roulette:turn', { playerId, required, deadline: turn.deadline });
}

function advanceTurn(ctx: RoomContext, at: number) {
  if (finishIfNeeded(ctx, at)) return;
  const order = ctx.state.activeOrder as string[];
  let nextIndex = ctx.state.currentIndex;
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = (ctx.state.currentIndex + step) % order.length;
    if (ctx.state.players[order[candidate]]?.status === 'alive') {
      nextIndex = candidate;
      if (candidate <= ctx.state.currentIndex) ctx.state.round += 1;
      break;
    }
  }
  ctx.state.currentIndex = nextIndex;
  beginTurn(ctx, order[nextIndex], at);
}

function resolveTimeout(ctx: RoomContext, turnId: string) {
  const at = ctx.now();
  const turn = ctx.state.turn as Turn | null;
  if (!turn || turn.id !== turnId || ctx.state.phase !== 'playing') return;
  const player = ctx.state.players[turn.playerId] as GamePlayer;
  const damage = timeoutDamage(turn.required, turn.fired);
  player.health = clampHealth(player.health - damage);
  player.stats.timeouts += 1;
  if (player.health === 0) player.status = 'eliminated';
  ctx.state.turn = null;
  touch(ctx, at);
  ctx.broadcast('roulette:timeout', { playerId: player.id, damage, remaining: damage });
  advanceTurn(ctx, at);
}

function eventCopy(kind: EventKind, id: string, at: number, zoneAngle: number | null): RouletteEvent {
  const definitions: Record<EventKind, [string, string]> = {
    speed_up: ['烈酒加速', '转盘速度提升至 1.5 倍'],
    reverse: ['酒馆反转', '转盘开始逆向旋转'],
    heal_zone: ['暖炉祝福', '命中奖励区可恢复 1 点血量'],
    slow_zone: ['冰镇时刻', '命中奖励区可让转盘减速'],
    wide_zone: ['笨重镖区', '命中者下一回合使用 1.5 倍宽镖'],
    multishot_zone: ['三镖罚单', '命中者下一回合必须连续发射 3 支'],
  };
  return {
    id,
    kind,
    label: definitions[kind][0],
    description: definitions[kind][1],
    zoneAngle,
    zoneArc: zoneAngle === null ? null : ZONE_ARC,
    triggeredAt: at,
    activated: false,
  };
}

function triggerRandomEvent(ctx: RoomContext, at: number) {
  let kind = EVENT_KINDS[Math.floor(ctx.random() * EVENT_KINDS.length)];
  if (ctx.state.event?.kind === kind) {
    kind = EVENT_KINDS[(EVENT_KINDS.indexOf(kind) + 1) % EVENT_KINDS.length];
  }
  setRotation(ctx, at, kind === 'speed_up' ? 1.5 : 1, kind === 'reverse' ? -1 : 1);
  const isZone = kind.endsWith('_zone');
  const zoneAngle = isZone ? pickZoneAngle(ctx.state.darts, () => ctx.random()) : null;
  const event = eventCopy(kind, `event-${at}-${Math.floor(ctx.random() * 1_000_000)}`, at, zoneAngle);
  ctx.state.event = event;
  ctx.state.shotsSinceEvent = 0;
  ctx.state.nextEventAt = randomEventThreshold(ctx);
  touch(ctx, at);
  ctx.broadcast('roulette:event', event);
}

function applyZone(ctx: RoomContext, player: GamePlayer, boardAngle: number, at: number): string | null {
  const event = ctx.state.event as RouletteEvent | null;
  if (!event || event.zoneAngle === null || !isInsideZone(boardAngle, event.zoneAngle, event.zoneArc ?? ZONE_ARC)) {
    return null;
  }
  event.activated = true;
  switch (event.kind) {
    case 'heal_zone':
      player.health = clampHealth(player.health + 1);
      return 'heal';
    case 'slow_zone':
      setRotation(ctx, at, 0.7, 1);
      return 'slow';
    case 'wide_zone':
      player.nextTurnWidth = 1.5;
      return 'wide';
    case 'multishot_zone':
      player.nextTurnShots = 3;
      return 'multishot';
    default:
      return null;
  }
}

function resolveShot(ctx: RoomContext, shotId: string) {
  const pending = ctx.state.pendingShot as PendingShot | null;
  const turn = ctx.state.turn as Turn | null;
  if (!pending || pending.id !== shotId || !turn || ctx.state.phase !== 'playing') return;
  const at = pending.impactAt;
  const player = ctx.state.players[pending.playerId] as GamePlayer;
  const collision = findCollision(ctx.state.darts, pending.boardAngle, pending.widthFactor) as Dart | null;
  let score = 0;
  let zoneEffect: string | null = null;

  player.stats.shots += 1;
  turn.fired += 1;
  if (collision) {
    player.health = clampHealth(player.health - 1);
    player.stats.collisions += 1;
    if (player.health === 0) player.status = 'eliminated';
  } else {
    score = scoreSafeDart(ctx.state.darts, player.id, pending.boardAngle, pending.widthFactor);
    player.score += score;
    player.stats.safeHits += 1;
    ctx.state.darts.push({
      id: pending.id,
      ownerId: player.id,
      boardAngle: pending.boardAngle,
      widthFactor: pending.widthFactor,
      score,
    });
    zoneEffect = applyZone(ctx, player, pending.boardAngle, at);
  }

  ctx.state.pendingShot = null;
  ctx.state.shotsSinceEvent += 1;
  touch(ctx, at);
  ctx.broadcast('roulette:dart-resolved', {
    shotId,
    playerId: player.id,
    boardAngle: pending.boardAngle,
    collision: Boolean(collision),
    collisionOwnerId: collision?.ownerId ?? null,
    score,
    health: player.health,
    zoneEffect,
  });

  if (ctx.state.shotsSinceEvent >= ctx.state.nextEventAt) triggerRandomEvent(ctx, at);
  if (player.status !== 'alive' || turn.fired >= turn.required) {
    ctx.state.turn = null;
    advanceTurn(ctx, at);
  } else {
    turn.startedAt = at;
    turn.deadline = at + TURN_MS;
    touch(ctx, at);
    scheduleTurnTimeout(ctx, turn);
    ctx.broadcast('roulette:turn', { playerId: player.id, required: turn.required - turn.fired, deadline: turn.deadline });
  }
}

const room = defineRoom({
  meta: { name: '飞镖轮盘', minPlayers: 2, maxPlayers: 8 },

  initialState(): GameState {
    return {
      schema: 'dart-roulette@1',
      phase: 'lobby',
      hostId: null,
      serverNow: 0,
      players: {},
      activeOrder: [],
      currentIndex: 0,
      turn: null,
      rotation: { anchorAngle: 0, anchorAt: 0, speedFactor: 1, direction: 1 },
      darts: [],
      event: null,
      shotsSinceEvent: 0,
      nextEventAt: 4,
      pendingShot: null,
      winnerId: null,
      finishedAt: null,
      round: 1,
    };
  },

  onCreate(ctx: RoomContext) {
    touch(ctx);
  },

  onRestore(ctx: RoomContext) {
    const at = ctx.now();
    touch(ctx, at);
    if (ctx.state.phase !== 'playing') return;
    const pending = ctx.state.pendingShot as PendingShot | null;
    if (pending) {
      const delay = pending.impactAt - at;
      if (delay <= 0) resolveShot(ctx, pending.id);
      else ctx.setTimer('dart-roulette:shot', delay, () => resolveShot(ctx, pending.id));
      return;
    }
    const turn = ctx.state.turn as Turn | null;
    if (!turn) return;
    const delay = turn.deadline - at;
    if (delay <= 0) resolveTimeout(ctx, turn.id);
    else scheduleTurnTimeout(ctx, turn, delay);
  },

  onJoin(ctx: RoomContext, player: { id: string; name: string; role: string }) {
    const status: PlayerStatus = ctx.state.phase === 'lobby' ? 'waiting' : 'queued';
    ctx.state.players[player.id] = initialPlayer(player, status);
    if (player.role === 'host') ctx.state.hostId = player.id;
    touch(ctx);
  },

  onReconnect(ctx: RoomContext, player: { id: string; name: string; role: string }) {
    const existing = ctx.state.players[player.id] as GamePlayer | undefined;
    if (existing) {
      existing.connected = true;
      existing.name = player.name || existing.name;
    } else {
      ctx.state.players[player.id] = initialPlayer(player, ctx.state.phase === 'lobby' ? 'waiting' : 'queued');
    }
    touch(ctx);
  },

  onLeave(ctx: RoomContext, player: { id: string }) {
    const existing = ctx.state.players[player.id] as GamePlayer | undefined;
    if (!existing) return;
    if (ctx.state.phase === 'playing' && existing.status === 'alive') {
      existing.connected = false;
    } else {
      delete ctx.state.players[player.id];
    }
    touch(ctx);
  },

  actions: {
    start_game(ctx: RoomContext, { player }: { player: { id: string } }) {
      if (ctx.state.phase !== 'lobby' || player.id !== ctx.state.hostId) return;
      const candidates = Object.values(ctx.state.players as Record<string, GamePlayer>)
        .filter((candidate) => candidate.connected && candidate.status === 'waiting');
      if (candidates.length < 2 || candidates.length > 8) return;
      const at = ctx.now();
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
      ctx.state.rotation = { anchorAngle: 0, anchorAt: at, speedFactor: 1, direction: 1 };
      ctx.state.darts = [];
      ctx.state.event = null;
      ctx.state.shotsSinceEvent = 0;
      ctx.state.nextEventAt = randomEventThreshold(ctx);
      ctx.state.pendingShot = null;
      ctx.state.winnerId = null;
      ctx.state.finishedAt = null;
      ctx.state.round = 1;
      touch(ctx, at);
      beginTurn(ctx, order[0], at);
      ctx.broadcast('roulette:game-started', { order });
    },

    shoot(ctx: RoomContext, { player }: { player: { id: string } }) {
      const turn = ctx.state.turn as Turn | null;
      if (ctx.state.phase !== 'playing' || !turn || ctx.state.pendingShot || turn.playerId !== player.id) return;
      const shooter = ctx.state.players[player.id] as GamePlayer;
      if (!shooter || shooter.status !== 'alive') return;
      const firedAt = ctx.now();
      if (firedAt >= turn.deadline) {
        resolveTimeout(ctx, turn.id);
        return;
      }
      ctx.clearTimer('dart-roulette:turn');
      const impactAt = firedAt + SHOT_FLIGHT_MS;
      const worldAngle = -Math.PI / 2 + (shooter.seat / ctx.state.activeOrder.length) * TAU;
      const pending: PendingShot = {
        id: `dart-${firedAt}-${player.id}-${turn.fired}`,
        playerId: player.id,
        worldAngle,
        boardAngle: boardAngleFromWorld(ctx.state.rotation, worldAngle, impactAt),
        widthFactor: turn.dartWidth,
        firedAt,
        impactAt,
      };
      ctx.state.pendingShot = pending;
      touch(ctx, firedAt);
      ctx.broadcast('roulette:dart-fired', pending);
      ctx.setTimer('dart-roulette:shot', SHOT_FLIGHT_MS, () => resolveShot(ctx, pending.id));
    },

    return_to_lobby(ctx: RoomContext, { player }: { player: { id: string } }) {
      if (ctx.state.phase !== 'finished' || player.id !== ctx.state.hostId) return;
      const at = ctx.now();
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
      ctx.state.pendingShot = null;
      ctx.state.winnerId = null;
      ctx.state.finishedAt = null;
      touch(ctx, at);
    },
  },
});

export default room;
