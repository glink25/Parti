import { BOSS_INTERVAL, CHUNK_HEIGHT, WORLD_WIDTH, type Chunk, type GenerationContext, type Platform } from './contracts';
import { createRandom, scopedSeed } from './random';
import { biomeForChunk, encounterStrategies, makeBridge, stormWarden, weightedPlatform } from '../content';
import { canReachPlatform, MAX_ROUTE_RISE, wrapX } from '../runtime/physics';

export function difficultyFor(index: number) { return Math.min(10, Math.floor(index / 3)); }
export function boundaryX(seed: number, boundary: number) { return boundary === 0 ? WORLD_WIDTH / 2 : createRandom(scopedSeed(seed, boundary, 'boundary')).int(130, WORLD_WIDTH - 130); }
export function isBossChunk(index: number) { return index > 0 && (index + 1) % BOSS_INTERVAL === 0; }
export function contextFor(seed: number, chunkIndex: number, players: number): GenerationContext {
  return { seed, chunkIndex, players, difficulty: difficultyFor(chunkIndex), biome: biomeForChunk(chunkIndex), rng(channel) { return createRandom(scopedSeed(seed, chunkIndex, channel)); } };
}

function platform(id: string, x: number, y: number, width: number, optional = false): Platform { return { id, kind: 'normal', x: wrapX(x), y, width, optional }; }

function generateRoute(context: GenerationContext, entryX: number, exitX: number) {
  const base = context.chunkIndex * CHUNK_HEIGHT; const rng = context.rng('route');
  const result = [platform(`${context.chunkIndex}:route:0`, entryX, base + 70, 250)];
  let step = 1;
  while (result.at(-1)!.y < base + CHUNK_HEIGHT - MAX_ROUTE_RISE - 30) {
    const previous = result.at(-1)!; let next: Platform | null = null;
    for (let attempt = 0; attempt < 12 && !next; attempt += 1) {
      const minimumRise = 60 + Math.round(context.difficulty * 6);
      const maximumRise = 125 + Math.round(context.difficulty * 9);
      const remaining = base + CHUNK_HEIGHT - 70 - previous.y; const rise = Math.min(rng.int(minimumRise, maximumRise), remaining);
      const pull = (exitX - previous.x) * Math.min(.35, rise / Math.max(1, remaining));
      const candidate = platform(`${context.chunkIndex}:route:${step}`, previous.x + pull + rng.int(-270, 270), previous.y + rise, rng.int(145, 235));
      if (canReachPlatform(previous, candidate)) next = candidate;
    }
    if (!next) next = platform(`${context.chunkIndex}:route:${step}`, previous.x + Math.sign(exitX - previous.x) * 70, previous.y + Math.min(base + CHUNK_HEIGHT - 70 - previous.y, MAX_ROUTE_RISE, 95 + context.difficulty * 12), 220);
    result.push(next); step += 1;
  }
  const last = result.at(-1)!; const exit = platform(`${context.chunkIndex}:route:${step}`, exitX, base + CHUNK_HEIGHT - 70, 250);
  if (!canReachPlatform(last, exit)) {
    const bridge = platform(`${context.chunkIndex}:route:${step}`, wrapX(last.x + (exitX - last.x) * .5), Math.min(exit.y - 140, last.y + 180), 220);
    if (canReachPlatform(last, bridge) && canReachPlatform(bridge, exit)) { result.push(bridge); step += 1; exit.id = `${context.chunkIndex}:route:${step}`; }
    else exit.x = last.x;
  }
  result.push(exit); return result;
}

function generateOptional(context: GenerationContext, route: Platform[]) {
  const rng = context.rng('optional'); const result: Platform[] = []; const count = Math.min(8, 4 + Math.floor(context.difficulty / 2));
  for (let i = 0; i < count; i += 1) {
    const anchor = route[rng.int(1, Math.max(1, route.length - 2))]!;
    const base = platform(`${context.chunkIndex}:optional:${i}`, anchor.x + (rng.float() < .5 ? -1 : 1) * rng.int(170, 280), anchor.y + rng.int(-20, 100), rng.int(115, 180), true);
    const item = weightedPlatform(context, i).apply(base, context, i); result.push(item);
    if (item.kind === 'trigger') result.push(makeBridge(item));
  }
  return result;
}

export function generateChunk(seed: number, index: number, players: number): Chunk {
  const context = contextFor(seed, index, players); const entryX = boundaryX(seed, index); const exitX = boundaryX(seed, index + 1);
  if (isBossChunk(index)) {
    const platforms = stormWarden.arenaPlatforms(context); const boss = stormWarden.create(context, 0, null);
    return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, boss: true, entryX, exitX, route: platforms.map((p) => p.id), platforms, enemies: [boss], pickups: [] };
  }
  const route = generateRoute(context, entryX, exitX); const optional = generateOptional(context, route); const encounter = encounterStrategies.require('mixed').populate(context, route, optional);
  return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, boss: false, entryX, exitX, route: route.map((p) => p.id), platforms: [...route, ...optional], ...encounter };
}

export function findEntity(seed: number, players: number, id: string) {
  const index = Number(id.split(':')[0]); if (!Number.isInteger(index) || index < 0) return null;
  const chunk = generateChunk(seed, index, players);
  return chunk.platforms.find((x) => x.id === id) ?? chunk.enemies.find((x) => x.id === id) ?? chunk.pickups.find((x) => x.id === id) ?? null;
}

export function platformActive(platform: Platform, state: Record<string, { disabledUntil?: number; activatedUntil?: number }>, now: number, bossDefeated: boolean) {
  if (platform.kind === 'boss-exit') return bossDefeated;
  if (platform.kind === 'bridge') return (state[platform.id]?.activatedUntil ?? 0) > now;
  return (state[platform.id]?.disabledUntil ?? 0) <= now;
}
