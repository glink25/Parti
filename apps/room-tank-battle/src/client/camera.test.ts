import { describe, expect, it } from 'vitest';
import { clampCameraTarget, smoothCamera, waitingCameraTarget } from './camera';

describe('limited follow camera', () => {
  it('clamps the 22x16 view inside a 26x20 map', () => {
    expect(clampCameraTarget({ x: 2, y: 2 }, 26, 20)).toEqual({ x: 11, y: 8 });
    expect(clampCameraTarget({ x: 24, y: 18 }, 26, 20)).toEqual({ x: 15, y: 12 });
  });

  it('smooths toward a living player target', () => {
    expect(smoothCamera({ x: 11, y: 8 }, { x: 15, y: 12 }, .25)).toEqual({ x: 12, y: 9 });
  });

  it('centers between the last tank position and base while waiting', () => {
    expect(waitingCameraTarget({ x: 12, y: 10 }, { x: 4, y: 10 })).toEqual({ x: 8, y: 10 });
  });
});
