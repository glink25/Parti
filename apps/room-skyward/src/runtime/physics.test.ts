import { describe, expect, it } from 'vitest';
import { FLIGHT_PROFILES, GRAVITY, JUMP_SPEED, MAX_ROUTE_RISE, SPRING_JUMP_SPEED, SUPER_JUMP_SPEED, applyGravity, damp, flightSample } from './physics';

describe('skyward movement tuning', () => {
  it('uses the intended jump hierarchy and reachable rise', () => {
    expect(JUMP_SPEED).toBe(1320);
    expect(SUPER_JUMP_SPEED).toBeGreaterThan(JUMP_SPEED);
    expect(SPRING_JUMP_SPEED).toBe(1850);
    expect(JUMP_SPEED ** 2 / (2 * Math.abs(GRAVITY))).toBeGreaterThan(MAX_ROUTE_RISE);
  });
  it.each([['rocket', 1050, 5500], ['propeller', 760, 6500]] as const)('%s accelerates, cruises, then loses power without changing total duration', (kind, maxSpeed, totalMs) => {
    const profile = FLIGHT_PROFILES[kind];
    expect(profile.maxSpeed).toBe(maxSpeed);
    expect(profile.accelerationMs + profile.cruiseMs + profile.unpoweredMs).toBe(totalMs);
    expect(flightSample(kind, 0).speed).toBe(0);
    expect(flightSample(kind, profile.accelerationMs).speed).toBe(profile.maxSpeed);
    expect(flightSample(kind, profile.accelerationMs + profile.cruiseMs).phase).toBe('unpowered');
    expect(flightSample(kind, totalMs).phase).toBe('finished');
  });
  it('supports an early forced shutdown without an upward velocity discontinuity', () => {
    const before = flightSample('rocket', 199, 200);
    const start = flightSample('rocket', 200, 200);
    const after = flightSample('rocket', 450, 200);
    expect(Math.abs(start.speed - before.speed)).toBeLessThan(2);
    expect(after.speed).toBe(start.speed);
    expect(start.phase).toBe('unpowered');
  });
  it('uses the same gravity step after powered flight', () => {
    expect(applyGravity(760, .02)).toBe(725);
    expect(applyGravity(-100, .02, .42)).toBe(-114.7);
  });
  it('damps camera targets without frame-rate-dependent jumps', () => {
    const oneFrame = damp(0, 100, 10, 1 / 30);
    const twoFrames = damp(damp(0, 100, 10, 1 / 60), 100, 10, 1 / 60);
    expect(oneFrame).toBeCloseTo(twoFrames, 8);
    expect(oneFrame).toBeGreaterThan(0);
    expect(oneFrame).toBeLessThan(100);
  });
});
