import type { Stroke } from './types';

export function renderableClassicStrokes(completed: Stroke[], active: Stroke | null, isDrawer: boolean) {
  if (!active || isDrawer) return completed;
  return [...completed, active];
}
