import { describe, expect, it } from 'vitest';
import { MOVE_SPEED, orientationAxis, tiltDirection } from './physics';

describe('skyward tilt physics', () => {
  it('maps device tilt continuously from the dead zone to full input', () => {
    expect(tiltDirection(4)).toBe(0);
    expect(tiltDirection(-4)).toBe(0);
    expect(tiltDirection(8)).toBeCloseTo(.5);
    expect(tiltDirection(-8)).toBeCloseTo(-.5);
    expect(tiltDirection(12)).toBe(1);
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

});
