import type { Stroke } from './types';

export const MAX_STROKES_PER_CANVAS = 300;
export const MAX_POINTS_PER_STROKE = 420;
export const MAX_POINTS_PER_CANVAS = 24_000;

export function canvasPointCount(strokes: Stroke[]) { return strokes.reduce((total, stroke) => total + stroke.points.length, 0); }
export function canApplyStroke(strokes: Stroke[], candidate: Stroke) { return strokes.length < MAX_STROKES_PER_CANVAS && candidate.points.length <= MAX_POINTS_PER_STROKE && canvasPointCount(strokes) + candidate.points.length <= MAX_POINTS_PER_CANVAS; }

