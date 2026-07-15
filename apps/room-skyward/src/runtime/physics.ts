import { PLAYER_RADIUS, WORLD_WIDTH, type MovementDefinition, type Platform } from '../game/contracts';
export const GRAVITY = -1750;
export const JUMP_SPEED = 1080;
export const MOVE_SPEED = 420;
export const TILT_ACCELERATION = 1200;
export const TILT_BRAKING = 1400;
export const MAX_ROUTE_RISE = 285;
export function wrapX(x: number) { return (x % WORLD_WIDTH + WORLD_WIDTH) % WORLD_WIDTH; }
export function wrappedDistance(a: number, b: number) { const d = Math.abs(a - b); return Math.min(d, WORLD_WIDTH - d); }
export function canReachPlatform(from: Platform, to: Platform) {
  const rise = to.y - from.y; if (rise < 0 || rise > MAX_ROUTE_RISE) return false;
  const g = Math.abs(GRAVITY); const disc = JUMP_SPEED ** 2 - 2 * g * rise; if (disc < 0) return false;
  const time = (JUMP_SPEED + Math.sqrt(disc)) / g;
  return wrappedDistance(from.x, to.x) <= MOVE_SPEED * time + from.width / 2 + to.width / 2 + PLAYER_RADIUS * .45;
}
export function movingX(x: number, movement: MovementDefinition | undefined, elapsedMs: number) {
  return movement ? Math.max(0, Math.min(WORLD_WIDTH, x + Math.sin(elapsedMs / movement.periodMs * Math.PI * 2 + movement.phase * Math.PI * 2) * movement.range)) : x;
}
export function directDistance(a: number, b: number) { return Math.abs(a - b); }
export function tiltDirection(angle: number) { const a = Math.abs(angle); return !Number.isFinite(angle) || a <= 3 ? 0 : Math.sign(angle) * Math.min(1, (a - 3) / 15); }
type ScreenAngle = 0 | 90 | 180 | 270;
export function orientationAxis(data: { beta: number | null; gamma: number | null; screenAngle: number }) {
  const angle = ((Math.round(data.screenAngle / 90) * 90 % 360 + 360) % 360) as ScreenAngle;
  switch (angle) {
    case 0: return { angle, value: data.gamma };
    case 90: return { angle, value: data.beta == null ? null : -data.beta };
    case 180: return { angle, value: data.gamma == null ? null : -data.gamma };
    case 270: return { angle, value: data.beta };
  }
}
export function updateTiltVelocity(velocity: number, direction: number, dt: number) {
  if (!Number.isFinite(velocity) || !Number.isFinite(direction) || !Number.isFinite(dt) || dt <= 0) return 0;
  if (direction) return Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, velocity + Math.max(-1, Math.min(1, direction)) * TILT_ACCELERATION * dt));
  const braking = TILT_BRAKING * dt;
  return Math.abs(velocity) <= braking ? 0 : velocity - Math.sign(velocity) * braking;
}
