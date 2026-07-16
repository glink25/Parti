import { describe, expect, it } from 'vitest';
import { canApplyStroke, MAX_POINTS_PER_CANVAS, MAX_STROKES_PER_CANVAS } from './canvas-budget';

const line = (id: string, count: number) => ({ id, tool: 'pen' as const, color: '#000', size: 4, points: Array.from({ length: count }, () => ({ x: .5, y: .5 })) });
describe('canvas budget', () => {
  it('allows 300 strokes but rejects the 301st', () => { const strokes = Array.from({ length: MAX_STROKES_PER_CANVAS - 1 }, (_, i) => line(String(i), 1)); expect(canApplyStroke(strokes, line('last', 1))).toBe(true); strokes.push(line('last', 1)); expect(canApplyStroke(strokes, line('extra', 1))).toBe(false); });
  it('rejects a stroke that would exceed 24,000 points', () => { const strokes = [line('base', MAX_POINTS_PER_CANVAS - 10)]; expect(canApplyStroke(strokes, line('ok', 10))).toBe(true); expect(canApplyStroke(strokes, line('too-many', 11))).toBe(false); });
});
