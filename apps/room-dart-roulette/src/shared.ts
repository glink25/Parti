import {
  boardAngleFromWorld,
  clampHealth,
  findCollision,
  isInsideZone,
  normalizeAngle,
  rotationAngleAt,
  scoreSafeDart,
  type Rotation,
} from './worker/logic';

export const INITIAL_TURN_MS = 15_000;
export const TURN_DECAY_MS = 2_000;
export const MIN_TURN_MS = 5_000;
export const SHOT_FLIGHT_MS = 520;
export const REBASE_MS = 150;
export const WATCHDOG_MS = 20_000;

export type Phase = 'lobby' | 'playing' | 'finished';
export type PlayerStatus = 'waiting' | 'queued' | 'alive' | 'eliminated';
export type EventKind = 'speed_up' | 'reverse' | 'heal_zone' | 'slow_zone' | 'wide_zone' | 'multishot_zone';
export type ZoneEffect = 'heal' | 'slow' | 'wide' | 'multishot' | null;

export type GamePlayer = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  status: PlayerStatus;
  seat: number;
  health: number;
  score: number;
  nextTurnShots: number;
  nextTurnWidth: number;
  stats: { shots: number; safeHits: number; collisions: number; timeouts: number };
};

export type Dart = {
  id: string;
  ownerId: string;
  boardAngle: number;
  widthFactor: number;
  score: number;
};

export type RouletteEvent = {
  id: string;
  kind: EventKind;
  label: string;
  description: string;
  zoneAngle: number | null;
  zoneArc: number | null;
  activated: boolean;
};

export type TurnSnapshot = {
  id: string;
  revision: number;
  playerId: string;
  required: number;
  durationMs: number;
  committed: number;
  dartWidth: number;
  accepted: boolean;
  lastAcceptedSeq: number;
  acceptedShotIds: string[];
  logicalElapsed: number;
};

export type ShotOutcome = {
  collisionTargetId: string | null;
  score: 0 | 10 | 30 | 60 | 100;
  zoneEffect: ZoneEffect;
};

export type ShotCommit = {
  turnId: string;
  revision: number;
  seq: number;
  shotId: string;
  playerId: string;
  windowElapsed: number;
  fireElapsed: number;
  impactElapsed: number;
  boardAngle: number;
  widthFactor: number;
  outcome: ShotOutcome;
  rotationAfter: Rotation;
};

export type TimeoutCommit = {
  turnId: string;
  revision: number;
  seq: number;
  finalElapsed: number;
  rotationEndAngle: number;
};

export type GameState = {
  schema: 'dart-roulette@2';
  phase: Phase;
  hostId: string | null;
  players: Record<string, GamePlayer>;
  activeOrder: string[];
  currentIndex: number;
  turn: TurnSnapshot | null;
  rotation: Rotation;
  darts: Dart[];
  event: RouletteEvent | null;
  shotsSinceEvent: number;
  nextEventAt: number;
  eventDue: boolean;
  boardRevision: number;
  turnRevision: number;
  winnerId: string | null;
  round: number;
};

export type SimulatedShot = ShotCommit & {
  dart: Dart | null;
};

export type ShotValidationReason =
  | 'DUPLICATE' | 'NOT_CURRENT_PLAYER' | 'STALE_TURN' | 'OUT_OF_ORDER' | 'BAD_TIMING'
  | 'BAD_ANGLE' | 'BAD_WIDTH' | 'BAD_ROTATION' | 'BAD_COLLISION_TARGET'
  | 'BAD_COLLISION_RESULT' | 'BAD_SCORE' | 'BAD_ZONE_EFFECT';

export function lobbyReadiness(players: Record<string, GamePlayer>) {
  const candidates = Object.values(players).filter((player) => player.connected && player.status === 'waiting');
  const unready = candidates.filter((player) => !player.ready);
  return {
    candidates,
    unready,
    canStart: candidates.length >= 2 && candidates.length <= 8 && unready.length === 0,
  };
}

export function seatWorldAngle(seat: number, playerCount: number): number {
  return -Math.PI / 2 + (seat / playerCount) * Math.PI * 2;
}

export function turnDurationForRound(round: number): number {
  return Math.max(MIN_TURN_MS, INITIAL_TURN_MS - Math.max(0, round - 1) * TURN_DECAY_MS);
}

export function zoneEffectFor(event: RouletteEvent | null, boardAngle: number): ZoneEffect {
  if (!event || event.zoneAngle === null || !isInsideZone(boardAngle, event.zoneAngle, event.zoneArc ?? undefined)) return null;
  if (event.kind === 'heal_zone') return 'heal';
  if (event.kind === 'slow_zone') return 'slow';
  if (event.kind === 'wide_zone') return 'wide';
  if (event.kind === 'multishot_zone') return 'multishot';
  return null;
}

export function validateShotCommit(input: {
  commit: ShotCommit;
  turn: TurnSnapshot;
  playerId: string;
  rotation: Rotation;
  darts: Dart[];
  event: RouletteEvent | null;
}): ShotValidationReason | null {
  const { commit, turn } = input;
  if (turn.playerId !== input.playerId || commit.playerId !== input.playerId) return 'NOT_CURRENT_PLAYER';
  if (commit.turnId !== turn.id || commit.revision !== turn.revision) return 'STALE_TURN';
  if (!commit.outcome || typeof commit.outcome !== 'object') return 'BAD_COLLISION_RESULT';
  if (turn.acceptedShotIds.includes(commit.shotId) || input.darts.some((dart) => dart.id === commit.shotId)) return 'DUPLICATE';
  if (commit.seq !== turn.lastAcceptedSeq + 1) return 'OUT_OF_ORDER';
  if (typeof commit.shotId !== 'string' || !commit.shotId || !Number.isFinite(commit.windowElapsed) || commit.windowElapsed < 0 || commit.windowElapsed > turn.durationMs) return 'BAD_TIMING';
  if (!Number.isFinite(commit.fireElapsed) || Math.abs(commit.fireElapsed - (turn.logicalElapsed + commit.windowElapsed)) > 0.5) return 'BAD_TIMING';
  if (commit.fireElapsed > turn.durationMs + 0.5) return 'BAD_TIMING';
  if (!Number.isFinite(commit.impactElapsed) || Math.abs(commit.impactElapsed - (commit.fireElapsed + SHOT_FLIGHT_MS)) > 0.5) return 'BAD_TIMING';
  if (!Number.isFinite(commit.boardAngle) || commit.boardAngle < 0 || commit.boardAngle >= Math.PI * 2) return 'BAD_ANGLE';
  if (commit.widthFactor !== turn.dartWidth) return 'BAD_WIDTH';
  const after = commit.rotationAfter;
  if (!after || !Number.isFinite(after.anchorAngle) || !Number.isFinite(after.anchorElapsed) || after.anchorAngle < 0 || after.anchorAngle >= Math.PI * 2 || Math.abs(after.anchorElapsed - commit.impactElapsed) > 0.5) return 'BAD_ROTATION';
  if (commit.outcome.zoneEffect === 'slow') {
    if (after.speedFactor !== 0.7 || after.direction !== 1) return 'BAD_ROTATION';
  } else if (after.speedFactor !== input.rotation.speedFactor || after.direction !== input.rotation.direction) return 'BAD_ROTATION';
  const collisionId = commit.outcome?.collisionTargetId;
  if (collisionId !== null && !input.darts.some((dart) => dart.id === collisionId)) return 'BAD_COLLISION_TARGET';
  if (collisionId !== null && (commit.outcome.score !== 0 || commit.outcome.zoneEffect !== null)) return 'BAD_COLLISION_RESULT';
  if (collisionId === null && ![10, 30, 60, 100].includes(commit.outcome?.score)) return 'BAD_SCORE';
  const expectedEffect: ZoneEffect = input.event?.kind === 'heal_zone' ? 'heal'
    : input.event?.kind === 'slow_zone' ? 'slow'
      : input.event?.kind === 'wide_zone' ? 'wide'
        : input.event?.kind === 'multishot_zone' ? 'multishot' : null;
  if (commit.outcome?.zoneEffect !== null && commit.outcome.zoneEffect !== expectedEffect) return 'BAD_ZONE_EFFECT';
  return null;
}

export function simulateShot(input: {
  turn: TurnSnapshot;
  rotation: Rotation;
  darts: Dart[];
  event: RouletteEvent | null;
  ownerId: string;
  worldAngle: number;
  windowElapsed: number;
}): SimulatedShot {
  const fireElapsed = input.turn.logicalElapsed + input.windowElapsed;
  const impactElapsed = fireElapsed + SHOT_FLIGHT_MS;
  const boardAngle = boardAngleFromWorld(input.rotation, input.worldAngle, impactElapsed);
  const collision = findCollision(input.darts, boardAngle, input.turn.dartWidth) as Dart | null;
  const score = collision ? 0 : scoreSafeDart(input.darts, input.ownerId, boardAngle, input.turn.dartWidth) as 10 | 30 | 60 | 100;
  const zoneEffect = collision ? null : zoneEffectFor(input.event, boardAngle);
  const impactAngle = rotationAngleAt(input.rotation, impactElapsed);
  const rotationAfter: Rotation = {
    anchorAngle: impactAngle,
    anchorElapsed: impactElapsed,
    speedFactor: zoneEffect === 'slow' ? 0.7 : input.rotation.speedFactor,
    direction: zoneEffect === 'slow' ? 1 : input.rotation.direction,
  };
  const shotId = `${input.turn.id}:${input.turn.lastAcceptedSeq + 1}`;
  return {
    turnId: input.turn.id,
    revision: input.turn.revision,
    seq: input.turn.lastAcceptedSeq + 1,
    shotId,
    playerId: input.ownerId,
    windowElapsed: input.windowElapsed,
    fireElapsed,
    impactElapsed,
    boardAngle,
    widthFactor: input.turn.dartWidth,
    outcome: { collisionTargetId: collision?.id ?? null, score, zoneEffect },
    rotationAfter,
    dart: collision ? null : { id: shotId, ownerId: input.ownerId, boardAngle, widthFactor: input.turn.dartWidth, score },
  };
}

export function applyPredictedShot(players: Record<string, GamePlayer>, darts: Dart[], shot: SimulatedShot): void {
  const player = players[shot.playerId];
  if (!player) return;
  player.stats.shots += 1;
  if (shot.outcome.collisionTargetId) {
    player.health = clampHealth(player.health - 1);
    player.stats.collisions += 1;
    if (player.health === 0) player.status = 'eliminated';
    return;
  }
  if (shot.dart) darts.push(shot.dart);
  player.score += shot.outcome.score;
  player.stats.safeHits += 1;
  if (shot.outcome.zoneEffect === 'heal') player.health = clampHealth(player.health + 1);
  if (shot.outcome.zoneEffect === 'wide') player.nextTurnWidth = 1.5;
  if (shot.outcome.zoneEffect === 'multishot') player.nextTurnShots = 3;
}

export function normalizeRotation(rotation: Rotation, elapsed: number): Rotation {
  return {
    anchorAngle: normalizeAngle(rotationAngleAt(rotation, elapsed)),
    anchorElapsed: elapsed,
    speedFactor: rotation.speedFactor,
    direction: rotation.direction,
  };
}
