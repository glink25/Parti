import { CHUNK_HEIGHT, CHUNKS_PER_REGION, WORLD_WIDTH, type Connector, type EnemySpawn, type HazardZone, type Phase, type PickupSpawn, type Platform, type RegionKind, type TerrainChunk } from './types';
import { createRandom, scopedSeed, type Random } from './random';
import { wrappedInterpolate } from './physics';

type Biome = { id: string; name: string; sky: string; haze: string; platform: string; enemyKinds: Array<'drifter' | 'spike'> };
type SkeletonId = 'open-steps' | 'wrap-zigzag' | 'center-tower' | 'edge-climb' | 'wave-run' | 'split-lanes' | 'long-leaps' | 'stair-switch' | 'relay-spires' | 'relay-cross';

export const BIOMES: Biome[] = [
  { id: 'dawn', name: '晨光浮岛', sky: '#102a43', haze: '#6dd5ed', platform: '#f5d76e', enemyKinds: ['drifter'] },
  { id: 'garden', name: '苍翠天庭', sky: '#092f2c', haze: '#5bd6a2', platform: '#9fe870', enemyKinds: ['drifter', 'spike'] },
  { id: 'storm', name: '雷鸣高塔', sky: '#17142d', haze: '#8a7dff', platform: '#c6b8ff', enemyKinds: ['spike', 'drifter'] },
];

const NORMAL_SKELETONS: SkeletonId[] = ['open-steps', 'wrap-zigzag', 'center-tower', 'edge-climb', 'wave-run', 'split-lanes', 'long-leaps', 'stair-switch'];
const COOP_SKELETONS: SkeletonId[] = ['relay-spires', 'relay-cross'];
const skeletonCache = new Map<string, SkeletonId | 'boss-ascent'>();
const connector = (x = WORLD_WIDTH / 2): Connector => ({ minX: Math.max(40, x - 150), maxX: Math.min(WORLD_WIDTH - 40, x + 150), minY: 0, maxY: 180, wrap: true });
const wrap = (x: number) => (x + WORLD_WIDTH) % WORLD_WIDTH;
const platform = (id: string, x: number, y: number, width = 180, kind: Platform['kind'] = 'normal'): Platform => ({ id, x: wrap(x), y, width, kind });
const enemyOnPlatform = (id: string, owner: Platform, kind: EnemySpawn['kind'], x = owner.x): EnemySpawn => ({ id, platformId: owner.id, x: wrap(x), y: owner.y + 72, kind });
const pickupOnPlatform = (id: string, owner: Platform, kind: PickupSpawn['kind']): PickupSpawn => ({ id, platformId: owner.id, x: owner.x, y: owner.y + 76, kind });

export function regionKindFor(index: number): RegionKind {
  if ((index + 1) % CHUNKS_PER_REGION === 0) return 'boss';
  return index % 3 === 2 ? 'cooperative' : 'normal';
}

export function biomeFor(index: number) { return BIOMES[Math.floor(index / CHUNKS_PER_REGION) % BIOMES.length]; }
export function gateY(gate: number) { return (gate * CHUNKS_PER_REGION - 1) * CHUNK_HEIGHT + 1120; }
export function gateForChunk(index: number) { return Math.floor(index / CHUNKS_PER_REGION) + 1; }
export function isBossCeilingActive(chunk: TerrainChunk, phase: Phase, nextGate: number) {
  return phase === 'boss' && chunk.regionKind === 'boss' && chunk.bossCeilingY != null && gateForChunk(chunk.index) === nextGate;
}
export function isBossExitActive(item: Platform, nextGate: number) {
  return item.kind !== 'boss-reveal' || nextGate > gateForChunk(Number(item.id.split(':')[0]));
}

function boundaryConnector(seed: number, boundary: number) {
  if (boundary === 0) return connector(WORLD_WIDTH / 2);
  return connector(createRandom(scopedSeed(seed, boundary, 'boundary')).int(170, WORLD_WIDTH - 170));
}

function skeletonFor(seed: number, index: number, region: RegionKind): SkeletonId | 'boss-ascent' {
  if (region === 'boss') return 'boss-ascent';
  const cacheKey = `${seed >>> 0}:${index}:${region}`; const cached = skeletonCache.get(cacheKey); if (cached) return cached;
  const pool = region === 'cooperative' ? COOP_SKELETONS : NORMAL_SKELETONS;
  const rng = createRandom(scopedSeed(seed, index, 'skeleton'));
  const recent = new Set<SkeletonId>();
  for (let back = 1; back <= 4 && index - back >= 0; back += 1) {
    const previousRegion = regionKindFor(index - back);
    if (previousRegion === region) recent.add(skeletonFor(seed, index - back, previousRegion) as SkeletonId);
  }
  const candidates = pool.filter((id) => !recent.has(id));
  const selected = rng.pick(candidates.length ? candidates : pool); skeletonCache.set(cacheKey, selected); return selected;
}

function routeX(id: SkeletonId, step: number, entryX: number, exitX: number, rng: Random) {
  const t = step / 9;
  if (step === 9) return exitX;
  switch (id) {
    case 'wrap-zigzag': return wrap(wrappedInterpolate(entryX, exitX, t) + (step % 2 ? 150 : -150));
    case 'center-tower': return wrap(WORLD_WIDTH / 2 + (step % 3 - 1) * 92);
    case 'edge-climb': return step < 5 ? 105 + step * 22 : WORLD_WIDTH - 105 - (9 - step) * 22;
    case 'wave-run': return wrap(WORLD_WIDTH / 2 + Math.sin(step * 1.35) * 285);
    case 'split-lanes': return step % 2 ? 245 : 655;
    case 'long-leaps': return wrap(wrappedInterpolate(entryX, exitX, t) + (step % 2 ? 245 : -245));
    case 'stair-switch': return wrap(entryX + Math.floor((step + 1) / 2) * (step % 4 < 2 ? 105 : -105));
    case 'relay-spires': return step % 2 ? 190 : 710;
    case 'relay-cross': return [450, 190, 450, 710][step % 4]!;
    default: return wrap(wrappedInterpolate(entryX, exitX, t) + rng.int(-80, 80));
  }
}

function generateRoute(seed: number, index: number, players: number, skeleton: SkeletonId, entry: Connector, exit: Connector) {
  const baseY = index * CHUNK_HEIGHT;
  const rng = createRandom(scopedSeed(seed, index, 'route'));
  const entryX = (entry.minX + entry.maxX) / 2; const exitX = (exit.minX + exit.maxX) / 2;
  const platforms: Platform[] = [platform(`${index}:start`, entryX, baseY + 80, 250)];
  for (let step = 1; step <= 9; step += 1) {
    const isRelay = skeleton.startsWith('relay') && (step === 3 || step === 5);
    const kind = isRelay ? (step === 3 ? 'relay-trigger' : 'relay-bridge') : 'normal';
    platforms.push(platform(`${index}:p${step}`, routeX(skeleton, step, entryX, exitX, rng), baseY + 80 + step * 155, skeleton === 'long-leaps' ? 205 : rng.int(155, 225), kind));
  }
  if (players === 1) for (const item of platforms) if (item.kind.startsWith('relay')) item.width = 250;
  return platforms;
}

function decorate(seed: number, index: number, difficulty: number, biome: Biome, route: Platform[]) {
  const rng = createRandom(scopedSeed(seed, index, 'decorations'));
  const platforms: Platform[] = [];
  const hazards: HazardZone[] = [];
  const tags: string[] = [];
  if (difficulty > 0) {
    const owner = route[rng.int(2, 7)]!;
    const side = rng.float() < .5 ? -1 : 1;
    const bonus = platform(`${index}:optional0`, owner.x + side * rng.int(170, 250), owner.y + rng.int(40, 105), rng.int(120, 165));
    bonus.optional = true;
    const mechanic = rng.pick(['move', 'blink', 'crumble', 'spikes', 'wind'] as const);
    tags.push(mechanic);
    if (mechanic === 'move') bonus.behavior = { type: 'move', axis: 'x', range: 95, periodMs: 2800 - Math.min(800, difficulty * 100), phase: rng.float() };
    if (mechanic === 'blink') bonus.behavior = { type: 'blink', periodMs: 2600, activeMs: 1800, phase: rng.float() };
    if (mechanic === 'crumble') bonus.behavior = { type: 'crumble', delayMs: 650 };
    if (mechanic === 'spikes') bonus.hazard = 'spikes';
    if (mechanic === 'wind') hazards.push({ id: `${index}:wind0`, kind: 'wind', x: bonus.x, y: bonus.y + 90, width: 230, height: 260, strength: side * 210 });
    platforms.push(bonus);
  }
  const enemyRng = createRandom(scopedSeed(seed, index, 'encounters'));
  const count = Math.min(3, 1 + Math.floor(difficulty / 2));
  const enemies = Array.from({ length: count }, (_, i) => {
    const owner = route[[3, 6, 8][i]!]!;
    return enemyOnPlatform(`${index}:e${i}`, owner, enemyRng.pick(biome.enemyKinds));
  });
  const rewardRng = createRandom(scopedSeed(seed, index, 'rewards'));
  const rewardOwner = platforms[0] ?? route[5]!;
  const pickups = rewardRng.float() < .52 ? [pickupOnPlatform(`${index}:b0`, rewardOwner, rewardRng.pick(['rapid', 'spread', 'power', 'team-shield'] as const))] : [];
  return { platforms, hazards, tags, enemies, pickups };
}

function generateBossChunk(index: number, entry: Connector, exit: Connector): TerrainChunk {
  const baseY = index * CHUNK_HEIGHT;
  const gate = gateForChunk(index);
  const route = [
    platform(`${index}:start`, (entry.minX + entry.maxX) / 2, baseY + 80, 250),
    platform(`${index}:p1`, 210, baseY + 260, 190), platform(`${index}:p2`, 650, baseY + 440, 190),
    platform(`${index}:p3`, 315, baseY + 620, 190), platform(`${index}:p4`, 675, baseY + 800, 190),
    platform(`${index}:arena`, 450, baseY + 980, 390),
    platform(`${index}:reveal0`, 650, baseY + 1160, 190, 'boss-reveal'),
    platform(`${index}:reveal1`, 290, baseY + 1340, 190, 'boss-reveal'),
    platform(`${index}:reveal2`, (exit.minX + exit.maxX) / 2, baseY + 1520, 220, 'boss-reveal'),
  ];
  return { index, moduleId: 'boss-ascent', biomeId: biomeFor(index).id, regionKind: 'boss', baseY, height: CHUNK_HEIGHT, entry, exit, platforms: route, route: route.map((p) => p.id), enemies: [], pickups: [], tags: ['boss', `gate-${gate}`], hazards: [], bossCeilingY: baseY + 1120 };
}

export function generateChunk(seed: number, index: number, players: number): TerrainChunk {
  const regionKind = regionKindFor(index); const biome = biomeFor(index); const baseY = index * CHUNK_HEIGHT;
  const entry = boundaryConnector(seed, index); const exit = boundaryConnector(seed, index + 1);
  if (regionKind === 'boss') return generateBossChunk(index, entry, exit);
  const skeleton = skeletonFor(seed, index, regionKind) as SkeletonId;
  const routePlatforms = generateRoute(seed, index, players, skeleton, entry, exit);
  const extras = decorate(seed, index, Math.floor(index / CHUNKS_PER_REGION), biome, routePlatforms);
  const relayTags = skeleton.startsWith('relay') ? ['cooperative', 'relay'] : [];
  return { index, moduleId: skeleton, biomeId: biome.id, regionKind, baseY, height: CHUNK_HEIGHT, entry, exit, platforms: [...routePlatforms, ...extras.platforms], route: routePlatforms.map((p) => p.id), enemies: extras.enemies, pickups: extras.pickups, tags: [skeleton, ...relayTags, ...extras.tags], hazards: extras.hazards };
}

export function findEnemy(seed: number, players: number, enemyId: string) {
  const index = Number(enemyId.split(':')[0]);
  if (!Number.isInteger(index) || index < 0) return null;
  return generateChunk(seed, index, players).enemies.find((enemy) => enemy.id === enemyId) ?? null;
}

export function platformTransform(item: Platform, now: number) {
  if (!item.behavior) return { x: item.x, y: item.y, active: true };
  const elapsed = now + ('phase' in item.behavior && 'periodMs' in item.behavior ? item.behavior.phase * item.behavior.periodMs : 0);
  if (item.behavior.type === 'move') {
    const offset = Math.sin(elapsed / item.behavior.periodMs * Math.PI * 2) * item.behavior.range;
    return { x: item.behavior.axis === 'x' ? wrap(item.x + offset) : item.x, y: item.behavior.axis === 'y' ? item.y + offset : item.y, active: true };
  }
  if (item.behavior.type === 'blink') return { x: item.x, y: item.y, active: elapsed % item.behavior.periodMs < item.behavior.activeMs };
  return { x: item.x, y: item.y, active: true };
}
