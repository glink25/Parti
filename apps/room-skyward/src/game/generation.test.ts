import { describe, expect, it } from 'vitest';
import { bossStrategies, CONTENT_FINGERPRINT, enemyPosition, enemyStrategies, pickupStrategies, platformStrategies } from '../content';
import { canReachPlatform, wrappedDistance } from '../runtime/physics';
import { BOSS_INTERVAL, WORLD_WIDTH, type Enemy, type Platform } from './contracts';
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
  it('is deterministic, unique, and joins chunk boundaries', () => { for (const seed of [0, 1, 42, 0xffffffff]) for (const players of [1, 4]) { const first = Array.from({ length: 30 }, (_, i) => generateChunk(seed, i, players)); expect(Array.from({ length: 30 }, (_, i) => generateChunk(seed, i, players))).toEqual(first); first.forEach((chunk, i) => { expect(chunk.entryX).toBe(boundaryX(seed, i)); expect(chunk.exitX).toBe(boundaryX(seed, i + 1)); if (!chunk.boss) { const route = new Map(chunk.platforms.map((item) => [item.id, item])); expect(route.get(chunk.route[0]!)?.x).toBe(chunk.entryX); expect(route.get(chunk.route.at(-1)!)?.x).toBe(chunk.exitX); } const ids = [...chunk.platforms, ...chunk.enemies, ...chunk.pickups].map((x) => x.id); expect(new Set(ids).size).toBe(ids.length); }); } });
  it('keeps every generated main route safe and reachable across many seeds', () => { for (let seed = 1; seed <= 250; seed += 1) for (let index = 0; index < 30; index += 1) { const chunk = generateChunk(seed, index, 3), byId = new Map(chunk.platforms.map((p) => [p.id, p])), route = chunk.route.map((id) => byId.get(id)!); if (!chunk.boss) expect(route.every((item) => item.kind === 'normal')).toBe(true); for (let i = 1; i < route.length; i += 1) expect(canReachPlatform(route[i - 1]!, route[i]!), `${seed}:${index}:${i}`).toBe(true); } });
  it('registers complete versioned content', () => { expect(CONTENT_FINGERPRINT).toMatch(/^[0-9a-f]{8}$/); expect(platformStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['moving', 'fragile', 'recovering', 'spikes', 'trigger', 'spring'])); expect(enemyStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['sentry', 'floater', 'patroller', 'charger', 'occupier'])); expect(pickupStrategies.values().map((x) => x.id)).toEqual(expect.arrayContaining(['spread', 'pierce', 'rocket', 'propeller'])); expect(bossStrategies.values().map((x) => x.id)).toEqual(['mechanical-core', 'sky-behemoth', 'storm-warden']); for (const item of [...platformStrategies.values(), ...enemyStrategies.values(), ...pickupStrategies.values(), ...bossStrategies.values()]) expect(item.version).toBeGreaterThan(0); });
  it('cycles biomes and picks all three bosses deterministically', () => { const seen = new Set<string>(); for (let seed = 1; seed < 100; seed += 1) for (const index of [11, 23, 35]) { const chunk = generateChunk(seed, index, 2); seen.add(chunk.enemies[0]!.kind); expect(chunk.boss).toBe(true); } expect(seen).toEqual(new Set(['storm-warden', 'sky-behemoth', 'mechanical-core'])); });
  it('keeps bosses centered in the top arena band and moving horizontally', () => { const chunk = generateChunk(42, 11, 2), boss = chunk.enemies[0]!, strategy = enemyStrategies.require(boss.kind), start = strategy.position(boss, runtimeContext(contextFor(42, 11, 2), 0, 0)), later = strategy.position(boss, runtimeContext(contextFor(42, 11, 2), 0, 900)); expect(boss.x).toBe(450); expect(boss.y).toBeGreaterThanOrEqual(chunk.baseY + 1580); expect(later.x).not.toBe(start.x); expect(later.y).toBe(start.y); });
  it('places a locked boss arena every twelve chunks', () => { expect(BOSS_INTERVAL).toBe(12); const chunk = generateChunk(42, 11, 2), exit = chunk.platforms.find((p) => p.kind === 'boss-exit')!, context = runtimeContext(contextFor(42, 11, 2), 100, 200); expect(platformActive(exit, {}, context, false)).toBe(false); expect(platformActive(exit, {}, context, true)).toBe(true); });
  it('makes platform transitions idempotent', () => { const context = runtimeContext(contextFor(42, 1, 2), 0, 1000), platform = { id: '1:x', kind: 'recovering' as const, x: 0, y: 0, width: 100, optional: true, config: { recoverMs: 3000 } }, state = { kind: 'platform' as const, phase: 'hidden' as const, changedAt: 100, until: 2000 }; const strategy = platformStrategies.require('recovering'); expect(strategy.transition(platform, context, state)).toEqual(strategy.transition(platform, context, state)); });
  it('makes fragile platforms non-bouncing one-shot traps', () => { const context = runtimeContext(contextFor(42, 1, 2), 0, 1000), platform = { id: '1:fragile', kind: 'fragile' as const, x: 300, y: 400, width: 150, optional: true, config: { breakDelayMs: 700 } }, strategy = platformStrategies.require('fragile'), contact = strategy.contact(platform, context); expect(contact.bounceVelocity).toBeUndefined(); expect(contact.effects[0]).toMatchObject({ kind: 'entity-state', state: { kind: 'platform', phase: 'breaking' } }); const breaking = { kind: 'platform' as const, phase: 'breaking' as const, changedAt: 1000, until: 1700 }; expect(strategy.transition(platform, { ...context, now: 1699 }, breaking)).toEqual(breaking); expect(strategy.transition(platform, { ...context, now: 1700 }, breaking)).toMatchObject({ phase: 'hidden', until: null }); });
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
  it('adds dense optional route choices to ordinary chunks', () => { let optional = 0, samples = 0; for (let seed = 1; seed <= 40; seed += 1) for (let index = 0; index < 20; index += 1) { const chunk = generateChunk(seed, index, 2); if (chunk.boss) continue; const route = new Set(chunk.route); optional += chunk.platforms.filter((p) => !route.has(p.id) && p.kind !== 'bridge').length; samples += 1; } expect(optional / samples).toBeGreaterThanOrEqual(5); });
  it('keeps the opening chunk free of automatic pickup spawns', () => { for (let seed = 1; seed <= 100; seed += 1) expect(generateChunk(seed, 0, 2).pickups).toEqual([]); });
  it('keeps the first two chunks free of generated enemies', () => { for (let seed = 1; seed <= 100; seed += 1) for (const index of [0, 1]) expect(generateChunk(seed, index, 2).enemies).toEqual([]); });
  it('uses fragile platforms frequently as optional-route traps', () => {
    let fragile = 0, samples = 0;
    for (let seed = 1; seed <= 80; seed += 1) for (const index of [2, 3, 4, 5, 6, 7]) {
      const chunk = generateChunk(seed, index, 2); if (chunk.boss) continue;
      const route = new Set(chunk.route); fragile += chunk.platforms.filter((item) => item.kind === 'fragile' && !route.has(item.id)).length; samples += 1;
    }
    expect(fragile / samples).toBeGreaterThanOrEqual(1.5);
  });
  it('makes platform fields sparser with height while preserving choices near the start', () => {
    const average = (indices: number[]) => { let total = 0, samples = 0; for (let seed = 1; seed <= 40; seed += 1) for (const index of indices) { const chunk = generateChunk(seed, index, 2); if (!chunk.boss) { total += chunk.platforms.filter((p) => p.kind !== 'bridge').length; samples += 1; } } return total / samples; };
    expect(average([0, 1, 2, 3])).toBeGreaterThan(average([42, 43, 44, 45]));
    expect(average([0, 1, 2, 3])).toBeGreaterThanOrEqual(10);
  });
  it('offers multiple complete routes through most opening platform fields', () => {
    let multiple = 0, samples = 0;
    for (let seed = 1; seed <= 50; seed += 1) for (const index of [0, 1, 2, 3]) {
      const chunk = generateChunk(seed, index, 2); if (chunk.boss) continue;
      const route = new Map(chunk.platforms.map((item) => [item.id, item])), entry = route.get(chunk.route[0]!)!, exit = route.get(chunk.route.at(-1)!)!;
      const candidates = chunk.platforms.filter((item) => item.kind !== 'bridge').sort((a, b) => a.y - b.y), paths = new Map([[entry.id, 1]]);
      for (const candidate of candidates) if (candidate.id !== entry.id) {
        let count = 0;
        for (const previous of candidates) if (previous.y < candidate.y && paths.has(previous.id) && canReachPlatform(previous, candidate)) count = Math.min(2, count + paths.get(previous.id)!);
        if (count) paths.set(candidate.id, count);
      }
      if ((paths.get(exit.id) ?? 0) >= 2) multiple += 1; samples += 1;
    }
    expect(multiple / samples).toBeGreaterThanOrEqual(.8);
  });
  it('staggers neighboring platforms vertically instead of laying them out in rows', () => {
    let spread = 0, layers = 0;
    for (let seed = 1; seed <= 40; seed += 1) for (const index of [0, 1, 2, 3]) {
      const groups = new Map<string, number[]>();
      for (const item of generateChunk(seed, index, 2).platforms) {
        const match = item.id.match(/^\d+:field:(\d+):(\d+)$/); if (!match) continue;
        const values = groups.get(match[1]!) ?? []; values.push(item.y); groups.set(match[1]!, values);
      }
      for (const values of groups.values()) if (values.length > 1) { spread += Math.max(...values) - Math.min(...values); layers += 1; }
    }
    expect(spread / layers).toBeGreaterThanOrEqual(75);
  });
  it('keeps horizontal enemies inside their radius bounds with continuous turnarounds', () => {
    const context = contextFor(42, 1, 2), runtime = (now: number) => runtimeContext(context, 0, now);
    for (const controller of [{ kind: 'patrol' as const, axis: 'x' as const, range: 180, periodMs: 3200, phase: 0 }, { kind: 'charge' as const, range: 180, periodMs: 3800, warningMs: 700, phase: 0 }]) {
      const enemy: Enemy = { id: '1:test', kind: controller.kind === 'charge' ? 'charger' : 'patroller', x: 40, y: 500, hp: 1, radius: 34, stompable: true, controller, attacks: [], drops: [] };
      const points = Array.from({ length: 381 }, (_, i) => enemyPosition(enemy, runtime(i * 10)).x);
      expect(Math.min(...points)).toBeGreaterThanOrEqual(enemy.radius);
      expect(Math.max(...points)).toBeLessThanOrEqual(WORLD_WIDTH - enemy.radius);
      expect(Math.max(...points.slice(1).map((x, i) => Math.abs(x - points[i]!)))).toBeLessThan(12);
    }
  });
});
