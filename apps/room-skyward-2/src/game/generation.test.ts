import { describe, expect, it } from 'vitest';
import { enemyStrategies, pickupStrategies, platformStrategies } from '../content';
import { canReachPlatform, directDistance, JUMP_SPEED, movingX } from '../runtime/physics';
import { BOSS_INTERVAL } from './contracts';
import { boundaryX, generateChunk, platformActive } from './generation';
import { Registry } from './registry';

describe('skyward 2 procedural generation', () => {
  it('is deterministic and connects every chunk boundary', () => {
    for (const seed of [0, 1, 42, 987654, 0xffffffff]) for (const players of [1, 2, 4]) {
      const first = Array.from({ length: 30 }, (_, i) => generateChunk(seed, i, players));
      expect(Array.from({ length: 30 }, (_, i) => generateChunk(seed, i, players))).toEqual(first);
      for (let i = 0; i < first.length; i += 1) {
        expect(first[i].entryX).toBe(boundaryX(seed, i)); expect(first[i].exitX).toBe(boundaryX(seed, i + 1));
        expect(new Set([...first[i].platforms, ...first[i].enemies, ...first[i].pickups].map((e) => e.id)).size).toBe(first[i].platforms.length + first[i].enemies.length + first[i].pickups.length);
      }
    }
  });

  it('constructs reachable random routes without template identifiers', () => {
    for (let seed = 1; seed <= 80; seed += 1) for (let index = 0; index < 24; index += 1) {
      const chunk = generateChunk(seed, index, 3); const byId = new Map(chunk.platforms.map((p) => [p.id, p])); const route = chunk.route.map((id) => byId.get(id)!);
      expect(route.every(Boolean)).toBe(true); expect(chunk.platforms.some((p) => p.id.includes('template') || p.id.includes('skeleton'))).toBe(false);
      for (let i = 1; i < route.length; i += 1) expect(canReachPlatform(route[i - 1], route[i]), `${seed}:${index}:${i}`).toBe(true);
    }
  });

  it('registers every requested content example', () => {
    expect(platformStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['normal', 'moving', 'fragile', 'recovering', 'spikes', 'trigger', 'bridge', 'boss-exit']));
    expect(enemyStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['sentry', 'floater', 'patroller', 'storm-warden']));
    expect(pickupStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['shield', 'rapid', 'power', 'rocket', 'propeller', 'super-jump', 'slow-fall']));
  });

  it('keeps world entities on their own screen edge instead of wrapping collisions', () => {
    expect(directDistance(5, 895)).toBe(890);
    expect(movingX(895, { range: 100, periodMs: 1000, phase: .25 }, 0)).toBe(900);
  });

  it('starts compact, becomes sparser, and keeps enemies away from the safe route', () => {
    expect(JUMP_SPEED).toBeGreaterThan(930);
    const low = Array.from({ length: 20 }, (_, seed) => generateChunk(seed + 1, 0, 2).route.length);
    const high = Array.from({ length: 20 }, (_, seed) => generateChunk(seed + 1, 31, 2).route.length);
    expect(low.reduce((a, b) => a + b, 0) / low.length).toBeGreaterThan(high.reduce((a, b) => a + b, 0) / high.length);
    let generatedEnemies = 0;
    for (let seed = 1; seed <= 50; seed += 1) {
      const chunk = generateChunk(seed, 12, 2); const route = chunk.platforms.filter((platform) => chunk.route.includes(platform.id));
      generatedEnemies += chunk.enemies.length;
      for (const enemy of chunk.enemies.filter((item) => !item.boss)) expect(route.every((platform) => Math.abs(enemy.y - platform.y) > 140 || Math.abs(enemy.x - platform.x) > platform.width / 2 + enemy.radius + 55)).toBe(true);
    }
    expect(generatedEnemies).toBeGreaterThan(4); expect(generatedEnemies).toBeLessThan(45);
  });

  it('places the boss near the top of its chunk', () => {
    const chunk = generateChunk(42, BOSS_INTERVAL - 1, 4); expect(chunk.enemies.find((enemy) => enemy.boss)!.y - chunk.baseY).toBeGreaterThan(1300);
  });

  it('uses a ten-chunk boss cadence and locks every upward boss platform', () => {
    expect(BOSS_INTERVAL).toBe(10);
    for (let index = 0; index < 30; index += 1) expect(generateChunk(42, index, 2).boss).toBe([9, 19, 29].includes(index));
    const bossChunk = generateChunk(42, 9, 2); expect(bossChunk.platforms.at(-1)?.kind).toBe('boss-exit');
  });

  it('adds four to eight optional platform opportunities per normal chunk', () => {
    for (const index of [0, 5, 15, 35]) { const chunk = generateChunk(42, index, 2); expect(chunk.platforms.filter((platform) => platform.optional).length).toBeGreaterThanOrEqual(4); }
  });

  it('treats boss as a registered enemy and locks its exit until defeated', () => {
    const chunk = generateChunk(42, BOSS_INTERVAL - 1, 4); expect(chunk.boss).toBe(true); expect(chunk.enemies.filter((e) => e.boss)).toHaveLength(1);
    const exit = chunk.platforms.find((p) => p.kind === 'boss-exit')!; expect(platformActive(exit, {}, 100, false)).toBe(false); expect(platformActive(exit, {}, 100, true)).toBe(true);
  });

  it('models temporary and triggered platform state', () => {
    const recovering = { id: 'x', kind: 'recovering' as const, x: 0, y: 0, width: 1, optional: true };
    const bridge = { ...recovering, id: 'b', kind: 'bridge' as const };
    expect(platformActive(recovering, { x: { disabledUntil: 500 } }, 400, false)).toBe(false); expect(platformActive(recovering, { x: { disabledUntil: 500 } }, 501, false)).toBe(true);
    expect(platformActive(bridge, { b: { activatedUntil: 500 } }, 400, false)).toBe(true); expect(platformActive(bridge, { b: { activatedUntil: 500 } }, 501, false)).toBe(false);
  });

  it('rejects duplicate strategy ids', () => { const registry = new Registry<{ id: string }>(); registry.register({ id: 'x' }); expect(() => registry.register({ id: 'x' })).toThrow(/Duplicate/); });
});
