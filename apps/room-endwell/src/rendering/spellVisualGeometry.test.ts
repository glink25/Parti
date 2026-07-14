import { describe, expect, it } from 'vitest';
import { sprayParticles, visualElementLayers } from './spellVisualGeometry';

describe('spell visual geometry', () => {
  it('keeps secondary elements as visible accent layers', () => {
    expect(visualElementLayers(['rock', 'fire', 'ice', 'fire'])).toEqual({ primary: 'fire', accents: ['rock', 'ice'] });
    expect(visualElementLayers(['shield', 'life'])).toEqual({ primary: 'shield', accents: ['life'] });
  });
  it('moves spray particles forward over time instead of only jittering in place', () => {
    const before = sprayParticles({ x: 10, y: 20 }, { x: 1, y: 0 }, 300, Math.PI / 3, 0), after = sprayParticles({ x: 10, y: 20 }, { x: 1, y: 0 }, 300, Math.PI / 3, 120);
    expect(after[0]!.progress).toBeGreaterThan(before[0]!.progress); expect(after[0]!.x).toBeGreaterThan(before[0]!.x + 40); expect(before.every((particle) => particle.x >= 10)).toBe(true);
  });
  it('fans out gradually and fades particles at the end of the stream', () => {
    const particles = sprayParticles({ x: 0, y: 0 }, { x: 1, y: 0 }, 300, Math.PI / 2, 410), far = particles.filter((particle) => particle.progress > .78), edge = far.reduce((best, particle) => Math.abs(particle.y) > Math.abs(best.y) ? particle : best);
    expect(Math.abs(edge.y)).toBeGreaterThan(10); expect(far.some((particle) => particle.alpha < .8)).toBe(true);
  });
});
