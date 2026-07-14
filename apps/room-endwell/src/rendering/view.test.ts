import { describe, expect, it } from 'vitest';
import { alignToDevicePixel } from './view';

describe('alignToDevicePixel', () => {
  it.each([1, 1.5, 2])('aligns offsets at DPR %s', (dpr) => {
    const value = alignToDevicePixel(-312.37, dpr);
    expect(value * dpr).toBe(Math.round(value * dpr));
  });
});
