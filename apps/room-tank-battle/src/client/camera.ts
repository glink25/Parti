import type { Point } from '../game/contracts';

export const CAMERA_VIEW = { width: 22, height: 16 } as const;

export function clampCameraTarget(target: Point, mapWidth: number, mapHeight: number): Point {
  const halfWidth = CAMERA_VIEW.width / 2; const halfHeight = CAMERA_VIEW.height / 2;
  return {
    x: Math.max(halfWidth, Math.min(mapWidth - halfWidth, target.x)),
    y: Math.max(halfHeight, Math.min(mapHeight - halfHeight, target.y)),
  };
}

export function smoothCamera(current: Point, target: Point, amount = .18): Point {
  return { x: current.x + (target.x - current.x) * amount, y: current.y + (target.y - current.y) * amount };
}

export function waitingCameraTarget(lastPosition: Point, basePosition: Point): Point {
  return { x: (lastPosition.x + basePosition.x) / 2, y: (lastPosition.y + basePosition.y) / 2 };
}
