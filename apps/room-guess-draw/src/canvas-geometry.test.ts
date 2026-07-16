import { describe, expect, it } from 'vitest';
import { canvasScale, fitCanvas, normalizedCanvasPoint } from './canvas-geometry';

describe('4:3 logical canvas geometry', () => {
  it('letterboxes a wide container', () => { expect(fitCanvas(1200, 600)).toEqual({ left: 200, top: 0, width: 800, height: 600 }); });
  it('letterboxes a tall container', () => { expect(fitCanvas(400, 800)).toEqual({ left: 0, top: 250, width: 400, height: 300 }); });
  it('fills an existing 4:3 container', () => { expect(fitCanvas(800, 600)).toEqual({ left: 0, top: 0, width: 800, height: 600 }); });
  it('maps and clamps pointer coordinates against the displayed canvas', () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 };
    expect(normalizedCanvasPoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(normalizedCanvasPoint(300, 200, rect)).toEqual({ x: .5, y: .5 });
    expect(normalizedCanvasPoint(500, 350, rect)).toEqual({ x: 1, y: 1 });
    expect(normalizedCanvasPoint(0, 500, rect)).toEqual({ x: 0, y: 1 });
  });
  it('scales logical brush widths uniformly', () => { expect(canvasScale(800)).toBe(1); expect(canvasScale(400)).toBe(.5); });
});
