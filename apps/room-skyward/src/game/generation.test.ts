import { describe, expect, it } from 'vitest';
import { bossStrategies, CONTENT_FINGERPRINT, enemyStrategies, pickupStrategies, platformStrategies } from '../content';
import { canReachPlatform, wrappedDistance } from '../runtime/physics';
import { BOSS_INTERVAL, type Platform } from './contracts';
import { boundaryX, contextFor, generateChunk, platformActive, runtimeContext } from './generation';
import { Registry } from './registry';

type Box = { cx: number; halfW: number; y1: number; y2: number };
function occupationBoxOf(p: Platform): Box {
  let halfW = p.width / 2, y1 = p.y, y2 = p.y;
  const m = p.config?.movement;
  if (m) {
    if (m.axis === 'x') halfW += m.range;
    else if (m.axis === 'y') { y1 -= m.range; y2 += m.range; }
    else if (m.axis === 'path' && m.path?.length === 2) {
      const dx = m.path[1]!.x - m.path[0]!.x, dy = m.path[1]!.y - m.path[0]!.y;
      halfW += Math.abs(dx) / 2;
      y1 = Math.min(y1, p.y + dy); y2 = Math.max(y2, p.y + dy);
    }
  }
  return { cx: p.x, halfW, y1, y2 };
}
function occupationOverlaps(a: Box, b: Box): boolean {
  return wrappedDistance(a.cx, b.cx) < a.halfW + b.halfW + 40 && Math.abs((a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2) < 80;
}

describe('skyward generation and contracts', () => {
  it('is deterministic, unique, and joins chunk boundaries', () => { for (const seed of [0, 1, 42, 0xffffffff]) for (const players of [1, 4]) { const first = Array.from({ length: 30 }, (_, i) => generateChunk(seed, i, players)); expect(Array.from({ length: 30 }, (_, i) => generateChunk(seed, i, players))).toEqual(first); first.forEach((chunk, i) => { expect(chunk.entryX).toBe(boundaryX(seed, i)); expect(chunk.exitX).toBe(boundaryX(seed, i + 1)); const ids = [...chunk.platforms, ...chunk.enemies, ...chunk.pickups].map((x) => x.id); expect(new Set(ids).size).toBe(ids.length); }); } });
  it('keeps every generated main route reachable across many seeds', () => { for (let seed = 1; seed <= 250; seed += 1) for (let index = 0; index < 30; index += 1) { const chunk = generateChunk(seed, index, 3), byId = new Map(chunk.platforms.map((p) => [p.id, p])), route = chunk.route.map((id) => byId.get(id)!); for (let i = 1; i < route.length; i += 1) expect(canReachPlatform(route[i - 1]!, route[i]!), `${seed}:${index}:${i}`).toBe(true); } });
  it('registers complete versioned content', () => { expect(CONTENT_FINGERPRINT).toMatch(/^[0-9a-f]{8}$/); expect(platformStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['moving', 'fragile', 'recovering', 'spikes', 'trigger', 'spring'])); expect(enemyStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['sentry', 'floater', 'patroller', 'charger', 'occupier'])); expect(pickupStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['spread', 'pierce', 'rocket', 'propeller'])); expect(bossStrategies.values().map((x) => x.id)).toEqual(['mechanical-core', 'sky-behemoth', 'storm-warden']); for (const item of [...platformStrategies.values(), ...enemyStrategies.values(), ...pickupStrategies.values(), ...bossStrategies.values()]) expect(item.version).toBeGreaterThan(0); });
  it('cycles biomes and picks all three bosses deterministically', () => { const seen = new Set<string>(); for (let seed = 1; seed < 100; seed += 1) for (const index of [9, 19, 29]) { const chunk = generateChunk(seed, index, 2); seen.add(chunk.enemies[0]!.kind); expect(chunk.boss).toBe(true); } expect(seen).toEqual(new Set(['storm-warden', 'sky-behemoth', 'mechanical-core'])); });
  it('uses compact cadence and locks boss exits', () => { expect(BOSS_INTERVAL).toBe(10); const chunk = generateChunk(42, 9, 2), exit = chunk.platforms.find((p) => p.kind === 'boss-exit')!, context = runtimeContext(contextFor(42, 9, 2), 100, 200); expect(platformActive(exit, {}, context, false)).toBe(false); expect(platformActive(exit, {}, context, true)).toBe(true); });
  it('makes platform transitions idempotent', () => { const context = runtimeContext(contextFor(42, 1, 2), 0, 1000), platform = { id: '1:x', kind: 'recovering' as const, x: 0, y: 0, width: 100, optional: true, config: { recoverMs: 3000 } }, state = { kind: 'platform' as const, phase: 'hidden' as const, changedAt: 100, until: 2000 }; const strategy = platformStrategies.require('recovering'); expect(strategy.transition(platform, context, state)).toEqual(strategy.transition(platform, context, state)); });
  it('rejects duplicate ids and invalid versions', () => { const registry = new Registry<{ id: string; version: number }>(); registry.register({ id: 'x', version: 1 }); expect(() => registry.register({ id: 'x', version: 1 })).toThrow(/Duplicate/); expect(() => new Registry<{ id: string; version: number }>().register({ id: 'x', version: 0 })).toThrow(/version/); });
  it('keeps optional platforms out of moving/trigger/bridge occupation boxes', () => {
    for (let seed = 1; seed <= 50; seed += 1) for (const index of [3, 7, 13, 17, 23, 27]) {
      const chunk = generateChunk(seed, index, 3), routeSet = new Set(chunk.route);
      const occupation = chunk.platforms.filter((p) => routeSet.has(p.id)).map(occupationBoxOf);
      for (const opt of chunk.platforms.filter((p) => !routeSet.has(p.id))) {
        const box = occupationBoxOf(opt);
        // Bridges are packed tightly as a designed staircase; only assert the trigger and other
        // optional platforms stay clear of the group's footprint.
        if (opt.kind !== 'bridge') for (const existing of occupation) expect(occupationOverlaps(box, existing), `${seed}:${index}:${opt.id}`).toBe(false);
        occupation.push(box);
      }
    }
  });
  it('reduces main-route density while keeping the route reachable', () => {
    let total = 0, samples = 0;
    for (let seed = 1; seed <= 50; seed += 1) for (let index = 0; index < 30; index += 1) {
      if ((index + 1) % BOSS_INTERVAL === 0) continue;
      const chunk = generateChunk(seed, index, 2);
      total += chunk.route.length; samples += 1;
    }
    // CHUNK_HEIGHT=1600, max rise per jump ~285 → ~6-8 hops to cross a chunk.
    // New code should land between 5 and 10 (old code's narrower ranges produced ~12+).
    expect(total / samples).toBeLessThanOrEqual(10);
    expect(total / samples).toBeGreaterThanOrEqual(5);
  });
});
