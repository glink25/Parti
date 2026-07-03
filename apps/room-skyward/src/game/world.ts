import { CHUNK_HEIGHT, CHUNKS_PER_REGION, WORLD_WIDTH, type Connector, type EnemySpawn, type PickupSpawn, type Platform, type RegionKind, type TerrainChunk } from './types';
import { createRandom, scopedSeed, type Random } from './random';
import { wrappedInterpolate } from './physics';

type Biome = { id: string; name: string; sky: string; haze: string; platform: string; enemyKinds: Array<'drifter' | 'spike'> };
type TerrainContext = { seed: number; index: number; baseY: number; players: number; difficulty: number; biome: Biome; regionKind: RegionKind; rng: Random; entry: Connector; exit: Connector };
type TerrainModule = {
  id: string;
  tags: string[];
  weight: number;
  regions: RegionKind[];
  minDifficulty: number;
  maxDifficulty: number;
  minPlayers: number;
  maxPlayers: number;
  generate(ctx: TerrainContext): Omit<TerrainChunk, 'index' | 'moduleId' | 'biomeId' | 'regionKind' | 'baseY' | 'height' | 'entry'>;
};

export const BIOMES: Biome[] = [
  { id: 'dawn', name: '晨光浮岛', sky: '#102a43', haze: '#6dd5ed', platform: '#f5d76e', enemyKinds: ['drifter'] },
  { id: 'garden', name: '苍翠天庭', sky: '#092f2c', haze: '#5bd6a2', platform: '#9fe870', enemyKinds: ['drifter', 'spike'] },
  { id: 'storm', name: '雷鸣高塔', sky: '#17142d', haze: '#8a7dff', platform: '#c6b8ff', enemyKinds: ['spike', 'drifter'] },
];

const connector = (x = WORLD_WIDTH / 2): Connector => ({ minX: Math.max(40, x - 150), maxX: Math.min(WORLD_WIDTH - 40, x + 150), minY: 0, maxY: 180, wrap: true });
const platform = (id: string, x: number, y: number, width = 180, kind: Platform['kind'] = 'normal'): Platform => ({ id, x, y, width, kind });
const enemyOnPlatform = (id: string, owner: Platform, kind: EnemySpawn['kind'], x = owner.x): EnemySpawn => ({ id, platformId: owner.id, x, y: owner.y + 72, kind });
const pickupOnPlatform = (id: string, owner: Platform, kind: PickupSpawn['kind'], x = owner.x): PickupSpawn => ({ id, platformId: owner.id, x, y: owner.y + 76, kind });

function stepped(ctx: TerrainContext, zigzag: boolean) {
  const entryX = (ctx.entry.minX + ctx.entry.maxX) / 2; const exitX = (ctx.exit.minX + ctx.exit.maxX) / 2;
  const platforms: Platform[] = [platform(`${ctx.index}:start`, entryX, ctx.baseY + 80, 240)];
  for (let step = 1; step <= 9; step += 1) {
    const progress = step / 9;
    const jitter = step === 9 ? 0 : zigzag ? (step % 2 ? 1 : -1) * ctx.rng.int(55, 85) : ctx.rng.int(-70, 70);
    const x = (wrappedInterpolate(entryX, exitX, progress) + jitter + WORLD_WIDTH) % WORLD_WIDTH;
    platforms.push(platform(`${ctx.index}:p${step}`, x, ctx.baseY + 80 + step * 155, ctx.rng.int(145, 225)));
  }
  return {
    exit: ctx.exit, platforms, route: platforms.map((item) => item.id),
    enemies: [3, 6, 8].slice(0, 1 + Math.floor(ctx.difficulty / 2)).map((step, i) => enemyOnPlatform(`${ctx.index}:e${i}`, platforms[step], ctx.rng.pick(ctx.biome.enemyKinds))),
    pickups: ctx.rng.float() < 0.42 ? [pickupOnPlatform(`${ctx.index}:b0`, platforms[5], ctx.rng.pick(['rapid', 'spread', 'power', 'team-shield'] as const))] : [],
  };
}

export const TERRAIN_MODULES: TerrainModule[] = [
  {
    id: 'open-steps', tags: ['traversal', 'combat'], weight: 5, regions: ['normal'], minDifficulty: 0, maxDifficulty: 99, minPlayers: 1, maxPlayers: 4,
    generate: (ctx) => stepped(ctx, false),
  },
  {
    id: 'wrap-zigzag', tags: ['traversal', 'wrap'], weight: 4, regions: ['normal'], minDifficulty: 1, maxDifficulty: 99, minPlayers: 1, maxPlayers: 4,
    generate: (ctx) => stepped(ctx, true),
  },
  {
    id: 'relay-spires', tags: ['cooperative', 'relay'], weight: 3, regions: ['cooperative'], minDifficulty: 0, maxDifficulty: 99, minPlayers: 1, maxPlayers: 4,
    generate(ctx) {
      const left = ctx.rng.int(145, 250);
      const right = WORLD_WIDTH - left;
      const platforms = [platform(`${ctx.index}:start`, (ctx.entry.minX + ctx.entry.maxX) / 2, ctx.baseY + 70, 260)];
      for (let step = 1; step <= 9; step += 1) {
        const x = step % 2 ? left : right;
        platforms.push(platform(`${ctx.index}:relay${step}`, x, ctx.baseY + 70 + step * 155, 165, step === 3 ? 'relay-trigger' : step === 5 ? 'relay-bridge' : 'normal'));
      }
      if (ctx.players === 1) platforms.filter((p) => p.kind.startsWith('relay')).forEach((p) => { p.width = 240; });
      platforms.push(platform(`${ctx.index}:exit`, (ctx.exit.minX + ctx.exit.maxX) / 2, ctx.baseY + 1535, 220));
      return {
        exit: ctx.exit, platforms, route: platforms.map((item) => item.id),
        enemies: [enemyOnPlatform(`${ctx.index}:e0`, platforms[4], 'drifter')],
        pickups: [pickupOnPlatform(`${ctx.index}:b0`, platforms[7], 'team-shield')],
      };
    },
  },
  {
    id: 'boss-gate', tags: ['boss', 'gate'], weight: 1, regions: ['boss'], minDifficulty: 0, maxDifficulty: 99, minPlayers: 1, maxPlayers: 4,
    generate(ctx) {
      const gateY = ctx.baseY + 1120;
      const platforms = [
        platform(`${ctx.index}:start`, (ctx.entry.minX + ctx.entry.maxX) / 2, ctx.baseY + 70, 260),
        platform(`${ctx.index}:p1`, 190, ctx.baseY + 260), platform(`${ctx.index}:p2`, 650, ctx.baseY + 440),
        platform(`${ctx.index}:p3`, 300, ctx.baseY + 630), platform(`${ctx.index}:p4`, 700, ctx.baseY + 820),
        platform(`${ctx.index}:approach`, 570, ctx.baseY + 970, 210),
        platform(`${ctx.index}:gate`, WORLD_WIDTH / 2, gateY, WORLD_WIDTH, 'gate'),
        platform(`${ctx.index}:exit1`, 520, ctx.baseY + 1320, 210, 'boss-exit'),
        platform(`${ctx.index}:exit2`, (ctx.exit.minX + ctx.exit.maxX) / 2, ctx.baseY + 1515, 220, 'boss-exit'),
      ];
      return {
        exit: ctx.exit, platforms, route: platforms.map((item) => item.id),
        enemies: [enemyOnPlatform(`${ctx.index}:guard0`, platforms[6], 'drifter', 260), enemyOnPlatform(`${ctx.index}:guard1`, platforms[6], 'spike', 650)],
        pickups: [],
      };
    },
  },
];

function weightedPick(modules: TerrainModule[], rng: Random) {
  const total = modules.reduce((sum, module) => sum + module.weight, 0);
  let cursor = rng.float() * total;
  for (const module of modules) { cursor -= module.weight; if (cursor <= 0) return module; }
  return modules.at(-1)!;
}

export function regionKindFor(index: number): RegionKind {
  if ((index + 1) % CHUNKS_PER_REGION === 0) return 'boss';
  return index % 3 === 2 ? 'cooperative' : 'normal';
}

export function biomeFor(index: number) { return BIOMES[Math.floor(index / CHUNKS_PER_REGION) % BIOMES.length]; }
export function gateY(gate: number) { return (gate * CHUNKS_PER_REGION - 1) * CHUNK_HEIGHT + 1120; }
export function gateForChunk(index: number) { return Math.floor(index / CHUNKS_PER_REGION) + 1; }
export function isBossExitActive(platform: Platform, nextGate: number) {
  if (platform.kind !== 'boss-exit') return true;
  return nextGate > gateForChunk(Number(platform.id.split(':')[0]));
}

function boundaryConnector(seed: number, boundary: number) {
  if (boundary === 0) return connector(WORLD_WIDTH / 2);
  return connector(createRandom(scopedSeed(seed, boundary, 'boundary')).int(170, WORLD_WIDTH - 170));
}

export function generateChunk(seed: number, index: number, players: number): TerrainChunk {
  const regionKind = regionKindFor(index);
  const biome = biomeFor(index);
  const difficulty = Math.floor(index / CHUNKS_PER_REGION);
  const candidates = TERRAIN_MODULES.filter((module) => module.regions.includes(regionKind) && difficulty >= module.minDifficulty && difficulty <= module.maxDifficulty && players >= module.minPlayers && players <= module.maxPlayers).sort((a, b) => a.id.localeCompare(b.id));
  if (!candidates.length) throw new Error(`No terrain module for ${regionKind} at chunk ${index}`);
  const module = weightedPick(candidates, createRandom(scopedSeed(seed, index, 'module')));
  const entry = boundaryConnector(seed, index); const exit = boundaryConnector(seed, index + 1);
  const output = module.generate({ seed, index, baseY: index * CHUNK_HEIGHT, players, difficulty, biome, regionKind, rng: createRandom(scopedSeed(seed, index, 'terrain')), entry, exit });
  return { index, moduleId: module.id, biomeId: biome.id, regionKind, baseY: index * CHUNK_HEIGHT, height: CHUNK_HEIGHT, entry, ...output };
}

export function findEnemy(seed: number, players: number, enemyId: string) {
  const index = Number(enemyId.split(':')[0]);
  if (!Number.isInteger(index) || index < 0) return null;
  return generateChunk(seed, index, players).enemies.find((enemy) => enemy.id === enemyId) ?? null;
}
