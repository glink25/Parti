import type { Element, Vec2 } from '../game/contracts';

export type SprayParticle = Vec2 & { angle: number; progress: number; size: number; alpha: number };
export function primaryVisualElement(elements: readonly Element[]): Element { return [...new Set(elements)].find((element) => !['rock', 'shield', 'life'].includes(element)) ?? elements[0] ?? 'rock'; }

export function visualElementLayers(elements: readonly Element[]) {
  const unique = [...new Set(elements)], primary = primaryVisualElement(elements);
  return { primary, accents: unique.filter((element) => element !== primary).slice(0, 3) };
}

export function sprayParticles(origin: Vec2, direction: Vec2, range: number, coneAngle: number, ageMs: number, count = 18): SprayParticle[] {
  const facing = Math.atan2(direction.y, direction.x), half = coneAngle / 2;
  return Array.from({ length: count }, (_, index) => {
    const lane = index % 5, cycle = Math.floor(index / 5), phase = (ageMs / 560 + cycle * .29 + lane * .13) % 1;
    const progress = .06 + phase * .94, spread = (lane / 4 - .5) * 2, angle = facing + spread * half * (.18 + progress * .78), distance = range * progress;
    return { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance, angle, progress, size: 34 + progress * 52, alpha: Math.min(1, progress * 4) * (1 - Math.max(0, progress - .78) / .22) };
  });
}
