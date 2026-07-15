import { describe, expect, it } from 'vitest';
import { MOVE_SPEED, orientationAxis, tiltDirection, updateTiltVelocity } from './physics';

describe('skyward tilt physics', () => {
  it('maps device tilt continuously from the dead zone to full input', () => {
    expect(tiltDirection(3)).toBe(0);
    expect(tiltDirection(-3)).toBe(0);
    expect(tiltDirection(10.5)).toBeCloseTo(.5);
    expect(tiltDirection(-10.5)).toBeCloseTo(-.5);
    expect(tiltDirection(18)).toBe(1);
    expect(tiltDirection(-30)).toBe(-1);
    expect(tiltDirection(Number.NaN)).toBe(0);
    expect(MOVE_SPEED).toBe(420);
  });

  it('selects the horizontal tilt axis for every screen orientation', () => {
    expect(orientationAxis({ beta: 12, gamma: 7, screenAngle: 0 })).toEqual({ angle: 0, value: 7 });
    expect(orientationAxis({ beta: 12, gamma: 7, screenAngle: 90 })).toEqual({ angle: 90, value: -12 });
    expect(orientationAxis({ beta: 12, gamma: 7, screenAngle: 180 })).toEqual({ angle: 180, value: -7 });
    expect(orientationAxis({ beta: 12, gamma: 7, screenAngle: 270 })).toEqual({ angle: 270, value: 12 });
  });

  it('accelerates proportionally, clamps speed, brakes at neutral, and reverses', () => {
    expect(updateTiltVelocity(0, .5, .1)).toBe(60);
    expect(updateTiltVelocity(0, 1, .1)).toBe(120);
    expect(updateTiltVelocity(400, 1, .1)).toBe(MOVE_SPEED);
    expect(updateTiltVelocity(120, 0, .1)).toBe(0);
    expect(updateTiltVelocity(100, -1, .1)).toBe(-20);
  });

  it('produces nearly the same velocity across frame sizes', () => {
    const oneStep = updateTiltVelocity(0, .5, .2);
    const twoSteps = updateTiltVelocity(updateTiltVelocity(0, .5, .1), .5, .1);
    expect(twoSteps).toBeCloseTo(oneStep);
  });
});
