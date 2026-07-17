export const TAU = Math.PI * 2;
export const BASE_ROTATION_MS = 8_000;
export const STANDARD_DART_ANGLE = 0.055;
export const ZONE_ARC = Math.PI / 5;

export type DartLike = {
  ownerId: string;
  boardAngle: number;
  widthFactor: number;
};

export type Rotation = {
  anchorAngle: number;
  anchorAt: number;
  speedFactor: number;
  direction: 1 | -1;
};

export function normalizeAngle(angle: number): number {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

export function angularDistance(a: number, b: number): number {
  const distance = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(distance, TAU - distance);
}

export function rotationAngleAt(rotation: Rotation, at: number): number {
  const elapsed = Math.max(0, at - rotation.anchorAt);
  const delta = (elapsed / BASE_ROTATION_MS) * TAU * rotation.speedFactor * rotation.direction;
  return normalizeAngle(rotation.anchorAngle + delta);
}

export function boardAngleFromWorld(rotation: Rotation, worldAngle: number, at: number): number {
  return normalizeAngle(worldAngle - rotationAngleAt(rotation, at));
}

export function collisionLimit(widthA: number, widthB: number): number {
  return STANDARD_DART_ANGLE * (widthA + widthB) / 2;
}

export function findCollision(darts: DartLike[], boardAngle: number, widthFactor: number): DartLike | null {
  let closest: DartLike | null = null;
  let closestDistance = Infinity;
  for (const dart of darts) {
    const distance = angularDistance(boardAngle, dart.boardAngle);
    if (distance <= collisionLimit(widthFactor, dart.widthFactor) && distance < closestDistance) {
      closest = dart;
      closestDistance = distance;
    }
  }
  return closest;
}

export function scoreSafeDart(
  darts: DartLike[],
  ownerId: string,
  boardAngle: number,
  widthFactor: number,
): number {
  let nearestEdgeGap = Infinity;
  for (const dart of darts) {
    if (dart.ownerId === ownerId) continue;
    const centerDistance = angularDistance(boardAngle, dart.boardAngle);
    const edgeGap = centerDistance - collisionLimit(widthFactor, dart.widthFactor);
    nearestEdgeGap = Math.min(nearestEdgeGap, edgeGap / STANDARD_DART_ANGLE);
  }
  if (nearestEdgeGap <= 0.5) return 100;
  if (nearestEdgeGap <= 1.5) return 60;
  if (nearestEdgeGap <= 3) return 30;
  return 10;
}

export function isInsideZone(boardAngle: number, zoneAngle: number, arc = ZONE_ARC): boolean {
  return angularDistance(boardAngle, zoneAngle) <= arc / 2;
}

export function timeoutDamage(required: number, fired: number): number {
  return Math.max(0, required - fired);
}

export function clampHealth(health: number): number {
  return Math.max(0, Math.min(3, health));
}

export function pickZoneAngle(darts: DartLike[], random: () => number): number {
  if (darts.length === 0) return random() * TAU;
  let bestAngle = 0;
  let bestClearance = -1;
  for (let index = 0; index < 16; index += 1) {
    const candidate = random() * TAU;
    const clearance = Math.min(...darts.map((dart) => angularDistance(candidate, dart.boardAngle)));
    if (clearance > bestClearance) {
      bestAngle = candidate;
      bestClearance = clearance;
    }
  }
  return bestAngle;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
