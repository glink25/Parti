import { BOSS_INTERVAL, CHUNK_HEIGHT, WORLD_WIDTH, type BiomeDefinition, type BossStrategy, type EncounterStrategy, type EnemyStrategy, type GenerationContext, type PickupStrategy, type Platform, type PlatformStrategy } from '../game/contracts';
import { Registry } from '../game/registry';
import { wrapX } from '../runtime/physics';

export const biomes = new Registry<BiomeDefinition>();
biomes.register({ id: 'aurora', name: '极光层', background: '#101c3d', platform: '#68d8d6', accent: '#b9f5ff' });
biomes.register({ id: 'garden', name: '浮空花园', background: '#102f2a', platform: '#80d86b', accent: '#e3ff8b' });
biomes.register({ id: 'storm', name: '雷暴层', background: '#24183f', platform: '#b18cff', accent: '#ffe66d' });

export const platformStrategies = new Registry<PlatformStrategy>();
const strategy = (id: PlatformStrategy['id'], safe: boolean, weight: number, mutate: PlatformStrategy['apply'] = (p) => p) => platformStrategies.register({ id, safe, weight, apply: (p, c, i) => mutate({ ...p, kind: id }, c, i) });
strategy('normal', true, 5);
strategy('moving', false, 2, (p, c, i) => ({ ...p, movement: { range: c.rng(`platform:${i}`).int(60, 130), periodMs: c.rng(`platform-time:${i}`).int(2100, 3600), phase: c.rng(`platform-phase:${i}`).float() } }));
strategy('fragile', false, 1.4);
strategy('recovering', false, 1.5, (p) => ({ ...p, recoverMs: 3200 }));
strategy('spikes', false, 1.1);
strategy('trigger', false, .8, (p) => ({ ...p, linkedId: `${p.id}:bridge` }));
strategy('bridge', false, 0);
strategy('boss-exit', false, 0);

export const enemyStrategies = new Registry<EnemyStrategy>();
enemyStrategies.register({ id: 'sentry', weight: 3, create(c, i, anchor) { return { id: `${c.chunkIndex}:enemy:sentry:${i}`, kind: 'sentry', x: anchor?.x ?? c.rng(`enemy-x:${i}`).int(80, 820), y: (anchor?.y ?? c.chunkIndex * CHUNK_HEIGHT + c.rng(`enemy-y:${i}`).int(250, 1400)) + (anchor ? 54 : 0), hp: 1, radius: 34 }; } });
enemyStrategies.register({ id: 'floater', weight: 2, create(c, i, anchor) { return { id: `${c.chunkIndex}:enemy:floater:${i}`, kind: 'floater', x: anchor?.x ?? c.rng(`enemy-x:${i}`).int(80, 820), y: anchor ? anchor.y + 105 : c.chunkIndex * CHUNK_HEIGHT + c.rng(`enemy-y:${i}`).int(260, 1380), hp: 1, radius: 35 }; } });
enemyStrategies.register({ id: 'patroller', weight: 2, create(c, i, anchor) { const rng = c.rng(`enemy:${i}`); return { id: `${c.chunkIndex}:enemy:patroller:${i}`, kind: 'patroller', x: anchor?.x ?? rng.int(100, 800), y: (anchor?.y ?? c.chunkIndex * CHUNK_HEIGHT + rng.int(260, 1380)) + (anchor ? 54 : 0), hp: 2, radius: 36, movement: { range: rng.int(70, 150), periodMs: rng.int(2200, 4000), phase: rng.float() } }; } });

export const pickupStrategies = new Registry<PickupStrategy>();
for (const [id, weight, durationMs] of [
  ['shield', 1.2, 0], ['rapid', 1.4, 12000], ['power', 1.2, 14000], ['rocket', .7, 4200], ['propeller', .9, 2800], ['super-jump', 1, 12000], ['slow-fall', 1, 12000],
] as const) pickupStrategies.register({ id, weight, durationMs, create(c, i, anchor) { return { id: `${c.chunkIndex}:pickup:${id}:${i}`, kind: id, x: anchor.x, y: anchor.y + 70, durationMs }; } });

export const stormWarden: BossStrategy = {
  id: 'storm-warden', weight: 0, boss: true,
  create(c) { const base = c.chunkIndex * CHUNK_HEIGHT; return { id: `${c.chunkIndex}:enemy:storm-warden:0`, kind: 'storm-warden', x: WORLD_WIDTH / 2, y: base + 1390, hp: 32 + c.difficulty * 5 + c.players * 12, radius: 105, boss: true }; },
  arenaPlatforms(c) {
    const base = c.chunkIndex * CHUNK_HEIGHT;
    return [
      { id: `${c.chunkIndex}:boss:entry`, kind: 'normal', x: 450, y: base + 120, width: 280, optional: false },
      { id: `${c.chunkIndex}:boss:left`, kind: 'normal', x: 205, y: base + 310, width: 190, optional: false },
      { id: `${c.chunkIndex}:boss:right`, kind: 'normal', x: 695, y: base + 500, width: 190, optional: false },
      { id: `${c.chunkIndex}:boss:arena`, kind: 'normal', x: 450, y: base + 690, width: 360, optional: false },
      { id: `${c.chunkIndex}:boss:exit0`, kind: 'boss-exit', x: 450, y: base + 880, width: 220, optional: false },
      { id: `${c.chunkIndex}:boss:exit1`, kind: 'boss-exit', x: 680, y: base + 1070, width: 190, optional: false },
      { id: `${c.chunkIndex}:boss:exit2`, kind: 'boss-exit', x: 360, y: base + 1260, width: 190, optional: false },
      { id: `${c.chunkIndex}:boss:exit3`, kind: 'boss-exit', x: 590, y: base + 1450, width: 200, optional: false },
      { id: `${c.chunkIndex}:boss:top`, kind: 'boss-exit', x: 450, y: base + 1530, width: 240, optional: false },
    ];
  },
};
enemyStrategies.register(stormWarden);

function weighted<T extends { id: string; weight: number }>(items: T[], value: number) {
  const total = items.reduce((n, item) => n + item.weight, 0); let cursor = value * total;
  for (const item of items) { cursor -= item.weight; if (cursor <= 0) return item; }
  return items.at(-1)!;
}

export const encounterStrategies = new Registry<EncounterStrategy>();
encounterStrategies.register({
  id: 'mixed', populate(context, route, optional) {
    const enemies = []; const pickups = []; const enemyPool = enemyStrategies.values().filter((item) => !item.boss && item.weight > 0);
    const enemyRng = context.rng('enemy-density');
    const safeAnchors = optional.filter((anchor) => route.every((platform) => Math.abs(anchor.y - platform.y) > 250 || Math.abs(anchor.x - platform.x) > platform.width / 2 + anchor.width / 2 + 90));
    const count = enemyRng.float() < Math.min(.75, .45 + context.difficulty * .03) ? Math.min(2, safeAnchors.length, enemyRng.int(1, context.difficulty >= 6 ? 2 : 1)) : 0;
    for (let i = 0; i < count; i += 1) {
      const rng = context.rng(`encounter:${i}`); const chosen = weighted(enemyPool, rng.float());
      const anchor = safeAnchors[i % safeAnchors.length] ?? null;
      enemies.push(chosen.create(context, i, anchor));
    }
    const rewardRng = context.rng('rewards');
    if (rewardRng.float() < .7) {
      const pool = pickupStrategies.values(); const picked = weighted(pool, rewardRng.float()); const anchor = optional[0] ?? route[Math.floor(route.length / 2)]!;
      pickups.push(picked.create(context, 0, anchor));
    }
    return { enemies, pickups };
  },
});

export function biomeForChunk(index: number) { return biomes.values()[Math.floor(index / BOSS_INTERVAL) % biomes.values().length]!; }
export function weightedPlatform(context: GenerationContext, index: number) {
  const pool = platformStrategies.values().filter((item) => item.weight > 0 && !item.safe); return weighted(pool, context.rng(`platform-kind:${index}`).float());
}
export function makeBridge(trigger: Platform): Platform { return { id: trigger.linkedId!, kind: 'bridge', x: wrapX(trigger.x + 220), y: trigger.y + 120, width: 190, optional: true }; }
