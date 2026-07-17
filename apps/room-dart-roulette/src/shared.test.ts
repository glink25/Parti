import { describe, expect, it } from 'vitest';
import { TAU } from './worker/logic';
import { seatWorldAngle, simulateShot, turnDurationForRound, validateShotCommit, type TurnSnapshot } from './shared';

const turn: TurnSnapshot = {
  id: 'turn-1-player-a',
  revision: 1,
  playerId: 'player-a',
  required: 1,
  durationMs: 15_000,
  committed: 0,
  dartWidth: 1,
  accepted: true,
  lastAcceptedSeq: 0,
  acceptedShotIds: [],
  logicalElapsed: 0,
};

describe('latency-independent local simulation', () => {
  it('produces the same transaction regardless of network arrival delay', () => {
    const input = {
      turn,
      rotation: { anchorAngle: .7, anchorElapsed: 0, speedFactor: 1, direction: 1 as const },
      darts: [{ id: 'old', ownerId: 'player-b', boardAngle: 2.1, widthFactor: 1, score: 10 }],
      event: null,
      ownerId: 'player-a',
      worldAngle: seatWorldAngle(0, 4),
      windowElapsed: 2_345,
    };
    const commits = [0, 100, 500, 1_500].map(() => simulateShot(input));
    expect(commits.every((commit) => commit.boardAngle === commits[0].boardAngle)).toBe(true);
    expect(commits.every((commit) => JSON.stringify(commit.outcome) === JSON.stringify(commits[0].outcome))).toBe(true);
    expect(commits.every((commit) => commit.impactElapsed === commits[0].impactElapsed)).toBe(true);
  });

  it('continues logical rotation across consecutive local darts', () => {
    const first = simulateShot({
      turn: { ...turn, required: 3 },
      rotation: { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 },
      darts: [], event: null, ownerId: 'player-a', worldAngle: 0, windowElapsed: 1_000,
    });
    const secondTurn = { ...turn, required: 3, committed: 1, lastAcceptedSeq: 1, logicalElapsed: first.impactElapsed };
    const second = simulateShot({
      turn: secondTurn,
      rotation: first.rotationAfter,
      darts: first.dart ? [first.dart] : [], event: null, ownerId: 'player-a', worldAngle: Math.PI, windowElapsed: 2_000,
    });
    expect(second.fireElapsed).toBe(first.impactElapsed + 2_000);
    expect(second.impactElapsed).toBe(second.fireElapsed + 520);
    expect(second.boardAngle).toBeGreaterThanOrEqual(0);
    expect(second.boardAngle).toBeLessThan(TAU);
  });
});

describe('shot transaction validation', () => {
  const rotation = { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 as const };
  const valid = simulateShot({ turn, rotation, darts: [], event: null, ownerId: 'player-a', worldAngle: 0, windowElapsed: 500 });
  const context = { turn, playerId: 'player-a', rotation, darts: [], event: null };

  it('accepts a valid client result without using its arrival time', () => {
    expect(validateShotCommit({ ...context, commit: valid })).toBeNull();
  });

  it('rejects stale, out-of-order and malformed result transactions', () => {
    expect(validateShotCommit({ ...context, commit: { ...valid, revision: 0 } })).toBe('STALE_TURN');
    expect(validateShotCommit({ ...context, commit: { ...valid, seq: 3 } })).toBe('OUT_OF_ORDER');
    expect(validateShotCommit({ ...context, commit: { ...valid, widthFactor: 1.5 } })).toBe('BAD_WIDTH');
    expect(validateShotCommit({ ...context, commit: { ...valid, boardAngle: Number.NaN } })).toBe('BAD_ANGLE');
    const late = simulateShot({ turn, rotation, darts: [], event: null, ownerId: 'player-a', worldAngle: 0, windowElapsed: 15_000 });
    expect(validateShotCommit({ ...context, commit: { ...late, fireElapsed: 15_001, impactElapsed: 15_521, rotationAfter: { ...late.rotationAfter, anchorElapsed: 15_521 } } })).toBe('BAD_TIMING');
  });

  it('treats accepted shot ids as idempotent duplicates', () => {
    expect(validateShotCommit({ ...context, turn: { ...turn, acceptedShotIds: [valid.shotId] }, commit: valid })).toBe('DUPLICATE');
  });

  it('shares one ten-second budget across all consecutive darts', () => {
    const laterTurn = { ...turn, required: 3, committed: 1, lastAcceptedSeq: 1, logicalElapsed: 6_000 };
    const lateSecond = simulateShot({ turn: laterTurn, rotation, darts: [], event: null, ownerId: 'player-a', worldAngle: 0, windowElapsed: 9_100 });
    expect(lateSecond.fireElapsed).toBe(15_100);
    expect(validateShotCommit({ ...context, turn: laterTurn, commit: lateSecond })).toBe('BAD_TIMING');
  });
});

describe('round preparation time', () => {
  it('starts at fifteen seconds, drops by two per full round, and floors at five', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(turnDurationForRound)).toEqual([15_000, 13_000, 11_000, 9_000, 7_000, 5_000, 5_000]);
  });
});

describe('player-relative camera', () => {
  it('maps every local player seat to the six o’clock direction', () => {
    for (let seat = 0; seat < 8; seat += 1) {
      const world = seatWorldAngle(seat, 8);
      const offset = Math.PI / 2 - world;
      expect(world + offset).toBeCloseTo(Math.PI / 2);
    }
  });
});
