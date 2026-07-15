import { PLAYER_RADIUS, WORLD_WIDTH, type MovementDefinition, type Platform } from '../game/contracts';
export const GRAVITY = -1750;
export const JUMP_SPEED = 1320;
export const SPRING_JUMP_SPEED = 1850;
export const SUPER_JUMP_SPEED = 1580;
export const MOVE_SPEED = 420;
export const TILT_DEAD_ZONE = 4;
export const TILT_FULL_SPEED_ANGLE = 12;
export const MAX_ROUTE_RISE = 400;
export const NORMAL_CAMERA_ANCHOR = .4;
export const BOSS_CAMERA_ANCHOR = .32;
export function applyGravity(velocity: number, dt: number, scale = 1) { return velocity + GRAVITY * scale * dt; }
export function damp(current: number, target: number, sharpness: number, dt: number) { return current + (target - current) * (1 - Math.exp(-Math.max(0, sharpness) * Math.max(0, dt))); }

export type FlightKind = 'rocket' | 'propeller';
export type FlightPhase = 'accelerating' | 'cruising' | 'unpowered' | 'finished';
export const FLIGHT_PROFILES = {
  rocket: { accelerationMs: 1000, cruiseMs: 3500, unpoweredMs: 1000, maxSpeed: 1050 },
  propeller: { accelerationMs: 1200, cruiseMs: 4100, unpoweredMs: 1200, maxSpeed: 760 },
} as const;
export function flightSample(kind: FlightKind, elapsedMs: number, forcedEndingAt?: number) {
  const profile = FLIGHT_PROFILES[kind];
  const naturalPowerEnd = profile.accelerationMs + profile.cruiseMs;
  const powerEnd = forcedEndingAt == null ? naturalPowerEnd : Math.min(naturalPowerEnd, forcedEndingAt);
  const elapsed = Math.max(0, elapsedMs);
  const accelerationProgressAtEnd = Math.min(1, Math.max(0, powerEnd / profile.accelerationMs));
  const cutoffSpeed = profile.maxSpeed * (1 - (1 - accelerationProgressAtEnd) ** 2);
  if (elapsed >= powerEnd + profile.unpoweredMs) return { phase: 'finished' as FlightPhase, speed: 0, progress: 1, powered: false };
  if (elapsed >= powerEnd) return { phase: 'unpowered' as FlightPhase, speed: cutoffSpeed, progress: (elapsed - powerEnd) / profile.unpoweredMs, powered: false };
  if (elapsed < profile.accelerationMs) {
    const progress = elapsed / profile.accelerationMs;
    return { phase: 'accelerating' as FlightPhase, speed: profile.maxSpeed * (1 - (1 - progress) ** 2), progress, powered: true };
  }
  return { phase: 'cruising' as FlightPhase, speed: profile.maxSpeed, progress: (elapsed - profile.accelerationMs) / Math.max(1, powerEnd - profile.accelerationMs), powered: true };
}
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
export function tiltDirection(angle: number) { const a = Math.abs(angle); return !Number.isFinite(angle) || a <= TILT_DEAD_ZONE ? 0 : Math.sign(angle) * Math.min(1, (a - TILT_DEAD_ZONE) / (TILT_FULL_SPEED_ANGLE - TILT_DEAD_ZONE)); }
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
