import { describe, expect, it } from 'vitest';
import { blizzardParticles, rainParticles } from './weatherParticles';

describe('weather particle sampling', () => {
  it('aligns rain streaks with their movement vector', () => { const particle = rainParticles(1280, 720, 1000)[0]!; expect(particle.velocity.x * particle.streak.x + particle.velocity.y * particle.streak.y).toBeGreaterThan(0); });
  it('aligns blizzard streaks with their movement vector', () => { const particle = blizzardParticles(1280, 720, 1000)[0]!; expect(particle.velocity.x * particle.streak.x + particle.velocity.y * particle.streak.y).toBeGreaterThan(0); });
  it('caps particle counts on large screens', () => { expect(rainParticles(2560, 1440, 1000).length).toBeLessThanOrEqual(100); expect(blizzardParticles(2560, 1440, 1000).length).toBeLessThanOrEqual(70); });
});
