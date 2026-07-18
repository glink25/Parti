import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from './constants';
import { lobbyReadiness, rankPlayers } from './lobby';
import type { GamePlayer } from './protocol';
import {
  angularDistance,
  findCollision,
  normalizeAngle,
  pickZoneAngle,
  reanchorRotation,
  rotationAngleAt,
  seatWorldAngle,
  turnDurationForRound,
  zoneContains,
} from './rules';

function makePlayer(id: string, overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id,
    name: id,
    isHost: false,
    status: 'waiting',
    connected: true,
    ready: false,
    seat: -1,
    health: 3,
    score: 0,
    stats: { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 },
    nextTurnShots: 1,
    nextTurnWidth: 1,
    ...overrides,
  };
}

describe('angle helpers', () => {
  it('normalizes into [0, TAU)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI * 2)).toBe(0);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5);
    expect(normalizeAngle(Math.PI * 5)).toBeCloseTo(Math.PI);
  });

  it('computes shortest angular distance', () => {
    expect(angularDistance(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(angularDistance(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2);
    expect(angularDistance(1, 1)).toBe(0);
  });
});

describe('rotation model', () => {
  it('rotates one full turn per 8000ms at speedFactor 1', () => {
    const rotation = { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 as const };
    expect(rotationAngleAt(rotation, 8000)).toBeCloseTo(0);
    expect(rotationAngleAt(rotation, 2000)).toBeCloseTo(Math.PI / 2);
    expect(rotationAngleAt(rotation, 4000)).toBeCloseTo(Math.PI);
  });

  it('respects direction and speedFactor', () => {
    const rotation = { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1.5, direction: -1 as const };
    // 1.5 倍速反向：8000/1.5 ms 一圈 → 4000ms 时走了 0.75 圈反向
    expect(rotationAngleAt(rotation, 4000)).toBeCloseTo(Math.PI * 2 * 0.25);
  });

  it('re-anchor keeps angle continuity', () => {
    const rotation = { anchorAngle: 0.3, anchorElapsed: 100, speedFactor: 1, direction: 1 as const };
    const at500 = rotationAngleAt(rotation, 500);
    const anchored = reanchorRotation(rotation, 500);
    expect(anchored.anchorAngle).toBeCloseTo(at500);
    expect(rotationAngleAt(anchored, 500)).toBeCloseTo(at500);
    expect(rotationAngleAt(anchored, 900)).toBeCloseTo(rotationAngleAt(rotation, 900));
  });
});

describe('turn duration', () => {
  it('decays per round with a floor', () => {
    expect(turnDurationForRound(1)).toBe(15000);
    expect(turnDurationForRound(2)).toBe(13000);
    expect(turnDurationForRound(6)).toBe(5000);
    expect(turnDurationForRound(99)).toBe(5000);
  });
});

describe('seat world angle', () => {
  it('distributes seats evenly from 12 o’clock', () => {
    expect(seatWorldAngle(0, 4)).toBe(0);
    expect(seatWorldAngle(1, 4)).toBeCloseTo(Math.PI / 2);
    expect(seatWorldAngle(3, 4)).toBeCloseTo(Math.PI * 1.5);
  });
});

describe('collision', () => {
  it('detects nearest dart within threshold', () => {
    const darts = [
      { id: 'a', ownerId: 'p1', boardAngle: 1.0, widthFactor: 1 },
      { id: 'b', ownerId: 'p2', boardAngle: 1.04, widthFactor: 1 },
      { id: 'c', ownerId: 'p3', boardAngle: 2.0, widthFactor: 1 },
    ];
    // 1.045 距 b(1.04) 为 0.005 < 阈值 0.055 → 撞 b
    expect(findCollision(darts, 1.045, 1)?.id).toBe('b');
    // 1.6 距所有镖都超阈值 → 无碰撞
    expect(findCollision(darts, 1.6, 1)).toBeNull();
  });

  it('wide darts collide more easily', () => {
    // 板上是宽镖（w=1.5）：新镖阈值 (0.055×(1.5+w)/2)
    const wide = [{ id: 'a', ownerId: 'p1', boardAngle: 1.0, widthFactor: 1.5 }];
    expect(findCollision(wide, 1.06, 1)).not.toBeNull(); // 0.06 ≤ 0.06875
    expect(findCollision(wide, 1.07, 1)).toBeNull(); // 0.07 > 0.06875
    expect(findCollision(wide, 1.07, 1.5)).not.toBeNull(); // 双方都宽：0.07 ≤ 0.0825
    // 板上是标准镖：0.06 > 0.055 不撞
    const standard = [{ id: 'a', ownerId: 'p1', boardAngle: 1.0, widthFactor: 1 }];
    expect(findCollision(standard, 1.06, 1)).toBeNull();
  });
});

describe('zone detection', () => {
  it('includes boundary', () => {
    const zone = 1.0;
    const half = Math.PI / 10; // ZONE_ARC / 2
    expect(zoneContains(zone, zone)).toBe(true);
    expect(zoneContains(zone, zone + half)).toBe(true);
    expect(zoneContains(zone, zone + half + 0.01)).toBe(false);
  });

  it('wraps around 0', () => {
    expect(zoneContains(0.05, Math.PI * 2 - 0.05)).toBe(true);
  });
});

describe('pickZoneAngle', () => {
  it('picks the candidate farthest from existing darts', () => {
    const darts = [{ id: 'a', ownerId: 'p1', boardAngle: 0, widthFactor: 1 }];
    const angle = pickZoneAngle(darts, () => 0.5);
    // 离 0 最远的采样点是 π
    expect(angle).toBeCloseTo(Math.PI);
  });
});

describe('lobbyReadiness', () => {
  it('requires 2–8 waiting players, all ready', () => {
    expect(lobbyReadiness([makePlayer('a', { ready: true })]).canStart).toBe(false);
    const two = [makePlayer('a', { ready: true }), makePlayer('b', { ready: true })];
    expect(lobbyReadiness(two).canStart).toBe(true);
    const oneNotReady = [makePlayer('a', { ready: true }), makePlayer('b')];
    const r = lobbyReadiness(oneNotReady);
    expect(r.canStart).toBe(false);
    expect(r.reason).toBe('not-all-ready');
    const tooMany = Array.from({ length: MAX_PLAYERS + 1 }, (_, i) =>
      makePlayer(`p${i}`, { ready: true }),
    );
    expect(lobbyReadiness(tooMany).reason).toBe('too-few-players');
  });
});

describe('rankPlayers', () => {
  it('winner first, then score, then safe hits', () => {
    const players = [
      makePlayer('a', { score: 100, stats: { shots: 3, safeHits: 3, collisions: 0, timeouts: 0 } }),
      makePlayer('b', { score: 50, stats: { shots: 2, safeHits: 2, collisions: 0, timeouts: 0 } }),
      makePlayer('c', { score: 100, stats: { shots: 4, safeHits: 4, collisions: 0, timeouts: 0 } }),
    ];
    const ranked = rankPlayers(players, 'b');
    expect(ranked.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
});
