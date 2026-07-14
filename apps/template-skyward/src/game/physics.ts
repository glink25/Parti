import { PLAYER_RADIUS, WORLD_WIDTH, type Platform } from './types';

export const GRAVITY = -1750;
export const JUMP_SPEED = 930;
export const MOVE_SPEED = 420;
export const MAX_ROUTE_RISE = 210;
export const TILT_DEAD_ZONE = 3;
export const TILT_FULL_SPEED_ANGLE = 18;

export function tiltDirectionForAngle(angle: number) {
  if (!Number.isFinite(angle)) return 0;
  const magnitude = Math.abs(angle);
  if (magnitude <= TILT_DEAD_ZONE) return 0;
  return Math.sign(angle) * Math.min(1, (magnitude - TILT_DEAD_ZONE) / (TILT_FULL_SPEED_ANGLE - TILT_DEAD_ZONE));
}

export function wrappedDistance(a: number, b: number) {
  const direct = Math.abs(a - b);
  return Math.min(direct, WORLD_WIDTH - direct);
}

export function wrappedInterpolate(from: number, to: number, amount: number) {
  let delta = to - from;
  if (delta > WORLD_WIDTH / 2) delta -= WORLD_WIDTH;
  if (delta < -WORLD_WIDTH / 2) delta += WORLD_WIDTH;
  return (from + delta * amount + WORLD_WIDTH) % WORLD_WIDTH;
}

export function canReachPlatform(from: Platform, to: Platform) {
  const rise = to.y - from.y;
  if (rise < 0 || rise > MAX_ROUTE_RISE) return false;
  const gravity = Math.abs(GRAVITY);
  const discriminant = JUMP_SPEED ** 2 - 2 * gravity * rise;
  if (discriminant < 0) return false;
  const descendingArrival = (JUMP_SPEED + Math.sqrt(discriminant)) / gravity;
  const horizontalTravel = MOVE_SPEED * descendingArrival + from.width / 2 + to.width / 2 + PLAYER_RADIUS * .45;
  return wrappedDistance(from.x, to.x) <= horizontalTravel;
}
