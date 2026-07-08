import { BOSS_INTERVAL, CHUNK_HEIGHT, WORLD_WIDTH, type Chunk, type ChunkRecipe, type DifficultyAxes, type DynamicEntityState, type GenerationContext, type Platform, type RuntimeContext } from './contracts';
import { createRandom, scopedSeed } from './random';
import { biomeForChunk, bossForContext, encounterStrategies, platformStrategies, weightedFromPool } from '../content';
import { canReachPlatform, MAX_ROUTE_RISE, wrappedDistance, wrapX } from '../runtime/physics';

export function difficultyFor(index: number) { return Math.min(10, Math.floor(index / 3)); }
export function difficultyAxesFor(index: number): DifficultyAxes { return { sparsity: Math.min(1, index / 45), hazardRate: Math.min(.75, .12 + index * .012), enemyDensity: Math.min(1, .18 + index * .022), enemyStrength: Math.min(1, index / 55), bossLevel: Math.min(5, 1 + Math.floor(index / 20)) }; }
export function boundaryX(seed: number, boundary: number) { return boundary === 0 ? WORLD_WIDTH / 2 : createRandom(scopedSeed(seed, boundary, 'boundary')).int(130, WORLD_WIDTH - 130); }
export function isBossChunk(index: number) { return index > 0 && (index + 1) % BOSS_INTERVAL === 0; }
export function bossOrdinalForChunk(index: number) { return Math.floor((index + 1) / BOSS_INTERVAL); }
export function contextFor(seed: number, chunkIndex: number, players: number): GenerationContext { return { seed, chunkIndex, players, difficulty: difficultyFor(chunkIndex), difficultyAxes: difficultyAxesFor(chunkIndex), biome: biomeForChunk(chunkIndex), rng(channel) { return createRandom(scopedSeed(seed, chunkIndex, channel)); } }; }
export function runtimeContext(context: GenerationContext, startedAt: number, now: number): RuntimeContext { return { ...context, startedAt, now }; }

function recipeFor(context: GenerationContext): ChunkRecipe { if (isBossChunk(context.chunkIndex)) return 'boss'; if ((context.chunkIndex + 2) % BOSS_INTERVAL === 0) return 'boss-buffer'; const r = context.rng('recipe').float(); return r < .14 ? 'reward' : r < .31 ? 'danger' : r < .45 ? 'mechanism' : 'normal'; }
function platform(id: string, x: number, y: number, width: number, optional = false): Platform { return { id, kind: 'normal', x: wrapX(x), y, width, optional }; }
function generateRoute(context: GenerationContext, entryX: number, exitX: number) {
  const base = context.chunkIndex * CHUNK_HEIGHT, rng = context.rng('route');
  const result = [platform(`${context.chunkIndex}:route:0`, entryX, base + 70, 250)];
  let step = 1;
  while (result.at(-1)!.y < base + CHUNK_HEIGHT - MAX_ROUTE_RISE - 30) {
    const previous = result.at(-1)!;
    let next: Platform | null = null;
    for (let attempt = 0; attempt < 12 && !next; attempt += 1) {
      const sparsity = context.difficultyAxes.sparsity;
      const bigLeap = attempt === 0 && rng.float() < .15;
      const min = bigLeap ? 245 : 130 + Math.round(sparsity * 40);
      const max = bigLeap ? 285 : 215 + Math.round(sparsity * 70);
      const remaining = base + CHUNK_HEIGHT - 70 - previous.y;
      const rise = Math.min(rng.int(min, max), remaining);
      const pull = (exitX - previous.x) * Math.min(.35, rise / Math.max(1, remaining));
      const candidate = platform(`${context.chunkIndex}:route:${step}`, previous.x + pull + rng.int(-270, 270), previous.y + rise, rng.int(145, 235));
      if (canReachPlatform(previous, candidate)) next = candidate;
    }
    if (!next) next = platform(`${context.chunkIndex}:route:${step}`, previous.x + Math.sign(exitX - previous.x) * 70, previous.y + Math.min(base + CHUNK_HEIGHT - 70 - previous.y, MAX_ROUTE_RISE, 220 + context.difficulty * 8), 220);
    result.push(next);
    step += 1;
  }
  const last = result.at(-1)!, exit = platform(`${context.chunkIndex}:route:${step}`, exitX, base + CHUNK_HEIGHT - 70, 250);
  if (!canReachPlatform(last, exit)) exit.x = last.x;
  result.push(exit);
  return result;
}

type OccupationBox = { cx: number; halfW: number; y1: number; y2: number };
function occupationBox(platform: Platform): OccupationBox {
  let halfW = platform.width / 2;
  let y1 = platform.y, y2 = platform.y;
  const m = platform.config?.movement;
  if (m) {
    if (m.axis === 'x') halfW += m.range;
    else if (m.axis === 'y') { y1 -= m.range; y2 += m.range; }
    else if (m.axis === 'path' && m.path?.length === 2) {
      const dx = m.path[1]!.x - m.path[0]!.x, dy = m.path[1]!.y - m.path[0]!.y;
      halfW += Math.abs(dx) / 2;
      y1 = Math.min(y1, platform.y + dy);
      y2 = Math.max(y2, platform.y + dy);
    }
  }
  return { cx: platform.x, halfW, y1, y2 };
}
function occupationOverlaps(a: OccupationBox, b: OccupationBox): boolean {
  return wrappedDistance(a.cx, b.cx) < a.halfW + b.halfW + 40 && Math.abs((a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2) < 80;
}
function generateOptional(context: GenerationContext, route: Platform[], recipe: ChunkRecipe) {
  const rng = context.rng('optional'), result: Platform[] = [];
  const count = Math.min(5, 2 + Math.floor(context.difficulty / 3));
  const occupation: OccupationBox[] = route.map(occupationBox);
  for (let i = 0; i < count; i += 1) {
    const anchor = route[rng.int(1, Math.max(1, route.length - 2))]!;
    let item: Platform | null = null, bridges: Platform[] = [];
    for (let attempt = 0; attempt < 12 && !item; attempt += 1) {
      const base = platform(`${context.chunkIndex}:optional:${i}`, anchor.x + (rng.float() < .5 ? -1 : 1) * rng.int(170, 280), anchor.y + rng.int(-20, 100), rng.int(115, 180), true);
      const pool = context.biome.content.platforms.filter((x) => recipe !== 'mechanism' || x.id === 'trigger' || x.id === 'spring');
      const id = weightedFromPool(pool.length ? pool : context.biome.content.platforms, context.rng(`platform-kind:${i}`).float());
      const candidate = platformStrategies.require(id).generate({ ...base, rewardMultiplier: recipe === 'danger' ? 1.75 : 1 }, context, i);
      const trigger = candidate.config?.trigger;
      const candidateBridges = trigger ? trigger.outputs.map((outputId, n) => ({ id: outputId, kind: 'bridge' as const, x: wrapX(candidate.x + 190 + n * 145), y: candidate.y + 100 + n * 55, width: 170, optional: true, rewardMultiplier: candidate.rewardMultiplier })) : [];
      const candidateBoxes = [occupationBox(candidate), ...candidateBridges.map(occupationBox)];
      if (candidateBoxes.some((box) => occupation.some((existing) => occupationOverlaps(box, existing)))) continue;
      item = candidate;
      bridges = candidateBridges;
    }
    if (!item) continue;
    result.push(item);
    occupation.push(occupationBox(item));
    for (const bridge of bridges) { result.push(bridge); occupation.push(occupationBox(bridge)); }
  }
  return result;
}

export function generateChunk(seed: number, index: number, players: number): Chunk { const context = contextFor(seed, index, players), recipe = recipeFor(context), entryX = boundaryX(seed, index), exitX = boundaryX(seed, index + 1); if (recipe === 'boss') { const strategy = bossForContext(context), platforms = strategy.arenaPlatforms(context), boss = strategy.create(context, 0, null); return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, difficultyAxes: context.difficultyAxes, recipe, boss: true, entryX, exitX, route: platforms.map((p) => p.id), platforms, enemies: [boss], pickups: [] }; } const route = generateRoute(context, entryX, exitX), optional = generateOptional(context, route, recipe), encounter = recipe === 'boss-buffer' ? { enemies: [], pickups: [] } : encounterStrategies.require('mixed').populate(context, route, optional); return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, difficultyAxes: context.difficultyAxes, recipe, boss: false, entryX, exitX, route: route.map((p) => p.id), platforms: [...route, ...optional], ...encounter }; }
export function findEntity(seed: number, players: number, id: string) { const index = Number(id.split(':')[0]); if (!Number.isInteger(index) || index < 0) return null; const chunk = generateChunk(seed, index, players); return chunk.platforms.find((x) => x.id === id) ?? chunk.enemies.find((x) => x.id === id) ?? chunk.pickups.find((x) => x.id === id) ?? null; }
export function transitionedState(platform: Platform, state: DynamicEntityState | undefined, context: RuntimeContext) { return platformStrategies.require(platform.kind).transition(platform, context, state); }
export function platformActive(platform: Platform, state: Record<string, DynamicEntityState>, context: RuntimeContext, bossDefeated: boolean) { if (platform.kind === 'boss-exit') return bossDefeated; const current = transitionedState(platform, state[platform.id], context); if (platform.kind === 'bridge') return current?.kind === 'platform' && current.phase === 'active' && (current.until == null || current.until > context.now); return current?.kind !== 'platform' || current.phase === 'active' || current.phase === 'warning'; }
export function platformPosition(platform: Platform, context: RuntimeContext) { const m = platform.config?.movement; if (!m) return { x: platform.x, y: platform.y }; const elapsed = Math.max(0, context.now - context.startedAt - (m.delayMs ?? 0)); if (!elapsed) return { x: platform.x, y: platform.y }; const travel = Math.max(1, m.periodMs - (m.pauseMs ?? 0) * 2), within = elapsed % m.periodMs; const normalized = within < (m.pauseMs ?? 0) ? 0 : within > travel + (m.pauseMs ?? 0) ? 1 : (within - (m.pauseMs ?? 0)) / travel; const offset = Math.sin(normalized * Math.PI * 2 + m.phase * Math.PI * 2) * m.range; if (m.axis === 'y') return { x: platform.x, y: platform.y + offset }; if (m.axis === 'path' && m.path?.length === 2) return { x: platform.x + (m.path[1]!.x - m.path[0]!.x) * ((Math.sin(normalized * Math.PI * 2 + m.phase * Math.PI * 2) + 1) / 2), y: platform.y + (m.path[1]!.y - m.path[0]!.y) * ((Math.sin(normalized * Math.PI * 2 + m.phase * Math.PI * 2) + 1) / 2) }; return { x: Math.max(0, Math.min(WORLD_WIDTH, platform.x + offset)), y: platform.y }; }
