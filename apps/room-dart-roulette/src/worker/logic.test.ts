import { describe, expect, it } from 'vitest';
import {
  BASE_ROTATION_MS,
  STANDARD_DART_ANGLE,
  TAU,
  angularDistance,
  boardAngleFromWorld,
  clampHealth,
  collisionLimit,
  findCollision,
  isInsideZone,
  normalizeAngle,
  pickZoneAngle,
  rotationAngleAt,
  scoreSafeDart,
  shuffle,
  timeoutDamage,
} from './logic';

describe('angle and rotation helpers', () => {
  it('normalizes angles and measures across the zero boundary', () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(TAU - Math.PI / 2);
    expect(normalizeAngle(TAU * 3 + .25)).toBeCloseTo(.25);
    expect(angularDistance(.05, TAU - .05)).toBeCloseTo(.1);
  });

  it('supports clockwise, accelerated and reverse rotation', () => {
    const clockwise = { anchorAngle: 0, anchorAt: 1_000, speedFactor: 1, direction: 1 as const };
    expect(rotationAngleAt(clockwise, 1_000 + BASE_ROTATION_MS / 4)).toBeCloseTo(Math.PI / 2);
    expect(rotationAngleAt({ ...clockwise, speedFactor: 1.5 }, 1_000 + BASE_ROTATION_MS / 4)).toBeCloseTo(Math.PI * .75);
    expect(rotationAngleAt({ ...clockwise, direction: -1 }, 1_000 + BASE_ROTATION_MS / 4)).toBeCloseTo(TAU - Math.PI / 2);
    expect(boardAngleFromWorld(clockwise, Math.PI, 1_000 + BASE_ROTATION_MS / 4)).toBeCloseTo(Math.PI / 2);
  });
});

describe('dart collision and scoring', () => {
  const existing = { ownerId: 'enemy', boardAngle: 0, widthFactor: 1 };

  it('treats touching edges as a collision and accounts for wide darts', () => {
    expect(findCollision([existing], collisionLimit(1, 1), 1)).toEqual(existing);
    expect(findCollision([existing], collisionLimit(1, 1) + .001, 1)).toBeNull();
    expect(findCollision([existing], collisionLimit(1.5, 1) - .001, 1.5)).toEqual(existing);
  });

  it('awards the agreed distance bands against the nearest enemy dart', () => {
    const angleAtGap = (gap: number) => collisionLimit(1, 1) + STANDARD_DART_ANGLE * gap;
    expect(scoreSafeDart([existing], 'self', angleAtGap(.49), 1)).toBe(100);
    expect(scoreSafeDart([existing], 'self', angleAtGap(1.49), 1)).toBe(60);
    expect(scoreSafeDart([existing], 'self', angleAtGap(2.99), 1)).toBe(30);
    expect(scoreSafeDart([existing], 'self', angleAtGap(3.01), 1)).toBe(10);
  });

  it('ignores friendly darts for scoring but not for collision', () => {
    const friendly = { ownerId: 'self', boardAngle: 0, widthFactor: 1 };
    expect(scoreSafeDart([friendly], 'self', 1, 1)).toBe(10);
    expect(findCollision([friendly], .01, 1)).toEqual(friendly);
  });
});

describe('turn and event helpers', () => {
  it('damages health by every unfired dart on timeout', () => {
    expect(timeoutDamage(1, 0)).toBe(1);
    expect(timeoutDamage(3, 1)).toBe(2);
    expect(timeoutDamage(3, 3)).toBe(0);
    expect(clampHealth(5)).toBe(3);
    expect(clampHealth(-2)).toBe(0);
  });

  it('uses the zone arc boundary inclusively', () => {
    expect(isInsideZone(.2, 0, .4)).toBe(true);
    expect(isInsideZone(.201, 0, .4)).toBe(false);
    expect(isInsideZone(TAU - .1, 0, .4)).toBe(true);
  });

  it('chooses the clearest sampled zone and deterministically shuffles', () => {
    const samples = [0, Math.PI, Math.PI / 2, Math.PI * 1.5];
    let index = 0;
    const chosen = pickZoneAngle([{ ownerId: 'a', boardAngle: 0, widthFactor: 1 }], () => samples[index++ % samples.length] / TAU);
    expect(chosen).toBeCloseTo(Math.PI);
    expect(shuffle([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
  });
});
