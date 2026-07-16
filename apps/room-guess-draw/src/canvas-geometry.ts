import type { Point } from './types';

export const LOGICAL_CANVAS_WIDTH = 800;
export const LOGICAL_CANVAS_HEIGHT = 600;

export type CanvasRect = { left: number; top: number; width: number; height: number };

export function fitCanvas(containerWidth: number, containerHeight: number): CanvasRect {
  const safeWidth = Math.max(1, containerWidth);
  const safeHeight = Math.max(1, containerHeight);
  const scale = Math.min(safeWidth / LOGICAL_CANVAS_WIDTH, safeHeight / LOGICAL_CANVAS_HEIGHT);
  const width = LOGICAL_CANVAS_WIDTH * scale;
  const height = LOGICAL_CANVAS_HEIGHT * scale;
  return { left: (safeWidth - width) / 2, top: (safeHeight - height) / 2, width, height };
}

export function normalizedCanvasPoint(clientX: number, clientY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Point {
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  return { x: Math.max(0, Math.min(1, (clientX - rect.left) / width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / height)) };
}

export function canvasScale(displayWidth: number) { return Math.max(0, displayWidth) / LOGICAL_CANVAS_WIDTH; }
