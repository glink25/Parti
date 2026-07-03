import { describe, expect, it } from 'vitest';
import { canReachPlatform, MAX_ROUTE_RISE } from './physics';
import { generateChunk, isBossExitActive, platformTransform } from './world';

describe('skyward world entity placement', () => {
  it('anchors every enemy and pickup to a platform', () => {
    for (const seed of [1, 42, 987654]) {
      for (let index = 0; index < 21; index += 1) {
        const chunk = generateChunk(seed, index, 4);
        const platforms = new Map(chunk.platforms.map((platform) => [platform.id, platform]));
        for (const enemy of chunk.enemies) {
          const platform = platforms.get(enemy.platformId);
          expect(platform, `${chunk.moduleId}:${enemy.id} platform`).toBeDefined();
          expect(enemy.y).toBe(platform!.y + 72);
          expect(Math.abs(enemy.x - platform!.x)).toBeLessThanOrEqual(platform!.width / 2);
        }
        for (const pickup of chunk.pickups) {
          const platform = platforms.get(pickup.platformId);
          expect(platform, `${chunk.moduleId}:${pickup.id} platform`).toBeDefined();
          expect(pickup.y).toBe(platform!.y + 76);
          expect(Math.abs(pickup.x - platform!.x)).toBeLessThanOrEqual(platform!.width / 2);
        }
      }
    }
  });

  it('generates a reachable route through consecutive chunks', () => {
    for (const seed of [1, 42, 987654]) for (const players of [1, 2, 3, 4]) {
      const chunks = Array.from({ length: 21 }, (_, index) => generateChunk(seed, index, players));
      for (const [index, chunk] of chunks.entries()) {
        const platforms = new Map(chunk.platforms.map((platform) => [platform.id, platform]));
        const route = chunk.route.map((id) => platforms.get(id)!);
        expect(route.every(Boolean), `${chunk.moduleId}:${index} route ids`).toBe(true);
        for (let step = 1; step < route.length; step += 1) {
          const rise = route[step].y - route[step - 1].y;
          expect(rise, `${chunk.moduleId}:${index} rise ${step}`).toBeLessThanOrEqual(MAX_ROUTE_RISE);
          expect(canReachPlatform(route[step - 1], route[step]), `${chunk.moduleId}:${index} step ${step}`).toBe(true);
        }
        if (index < chunks.length - 1) {
          const nextPlatforms = new Map(chunks[index + 1].platforms.map((platform) => [platform.id, platform]));
          const nextStart = nextPlatforms.get(chunks[index + 1].route[0])!;
          expect(route.at(-1)!.x).toBe(nextStart.x);
          expect(canReachPlatform(route.at(-1)!, nextStart), `boundary ${index}/${index + 1}`).toBe(true);
        }
      }
    }
  });

  it('keeps boss exits locked until that boss is defeated', () => {
    const bossChunk = generateChunk(42, 6, 4);
    const exits = bossChunk.platforms.filter((platform) => platform.kind === 'boss-reveal');
    expect(exits).toHaveLength(3);
    expect(exits.every((platform) => !isBossExitActive(platform, 1))).toBe(true);
    expect(exits.every((platform) => isBossExitActive(platform, 2))).toBe(true);
  });

  it('is deterministic and avoids repeating a route skeleton in the same region kind', () => {
    for (const seed of [1, 42, 987654, 0xffffffff]) {
      const first = Array.from({ length: 50 }, (_, index) => generateChunk(seed, index, 3));
      const second = Array.from({ length: 50 }, (_, index) => generateChunk(seed, index, 3));
      expect(second).toEqual(first);
      for (let index = 1; index < first.length; index += 1) {
        if (first[index].regionKind === first[index - 1].regionKind && first[index].regionKind !== 'boss') expect(first[index].moduleId).not.toBe(first[index - 1].moduleId);
      }
      expect(new Set(first.filter((chunk) => chunk.regionKind !== 'boss').map((chunk) => chunk.moduleId)).size).toBeGreaterThanOrEqual(8);
    }
  });

  it('keeps dynamic platform transforms deterministic', () => {
    const moving = { id: 'x', x: 100, y: 200, width: 150, kind: 'normal' as const, behavior: { type: 'move' as const, axis: 'x' as const, range: 80, periodMs: 2000, phase: .25 } };
    expect(platformTransform(moving, 12345)).toEqual(platformTransform(moving, 12345));
    expect(platformTransform(moving, 12345).x).not.toBe(platformTransform(moving, 12845).x);
  });
});
