import type { Vec2 } from '../game/contracts';

export type WeatherParticle = Vec2 & { velocity: Vec2; streak: Vec2; size: number; alpha: number };
const wrap = (value: number, span: number) => (value % span + span) % span;

export function rainParticles(width: number, height: number, now: number): WeatherParticle[] {
  const count = Math.min(100, Math.max(28, Math.ceil(width * height / 19000))), margin = 48, spanX = width + margin * 2, spanY = height + margin * 2, velocity = { x: -170, y: 480 };
  return Array.from({ length: count }, (_, index) => { const phase = now / 1000 + index * 13.37, x = wrap(index * 97 + velocity.x * phase, spanX) - margin, y = wrap(index * 61 + velocity.y * phase, spanY) - margin, length = 18 + index % 4 * 4, magnitude = Math.hypot(velocity.x, velocity.y); return { x, y, velocity, streak: { x: velocity.x / magnitude * length, y: velocity.y / magnitude * length }, size: index % 3 === 0 ? 1.7 : 1.15, alpha: .38 + index % 4 * .09 }; });
}

export function blizzardParticles(width: number, height: number, now: number): WeatherParticle[] {
  const count = Math.min(70, Math.max(22, Math.ceil(width * height / 28000))), margin = 42, spanX = width + margin * 2, spanY = height + margin * 2, velocity = { x: 260, y: 54 };
  return Array.from({ length: count }, (_, index) => { const phase = now / 1000 + index * 9.71, x = wrap(index * 113 + velocity.x * phase, spanX) - margin, baseY = wrap(index * 67 + velocity.y * phase, spanY) - margin, y = baseY + Math.sin(phase * 2.2) * 7, length = 7 + index % 3 * 2, magnitude = Math.hypot(velocity.x, velocity.y); return { x, y, velocity, streak: { x: velocity.x / magnitude * length, y: velocity.y / magnitude * length }, size: 1.2 + index % 3 * .35, alpha: .38 + index % 4 * .08 }; });
}
