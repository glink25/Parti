import { BOSS_INTERVAL, CHUNK_HEIGHT, WORLD_WIDTH, type Chunk, type ChunkRecipe, type DifficultyAxes, type DynamicEntityState, type GenerationContext, type Platform, type RuntimeContext } from './contracts';
import { createRandom, scopedSeed } from './random';
import { biomeForChunk, bossForContext, encounterStrategies, platformStrategies, weightedFromPool } from '../content';
import { canReachPlatform, wrappedDistance, wrapX } from '../runtime/physics';

export function difficultyFor(index: number) { return Math.min(10, Math.floor(index / 3)); }
export function difficultyAxesFor(index: number): DifficultyAxes { return { sparsity: Math.min(1, index / 45), hazardRate: Math.min(.75, .12 + index * .012), enemyDensity: Math.min(1, .18 + index * .022), enemyStrength: Math.min(1, index / 55), bossLevel: Math.min(5, 1 + Math.floor(index / 20)) }; }
export function boundaryX(seed: number, boundary: number) { return boundary === 0 ? WORLD_WIDTH / 2 : createRandom(scopedSeed(seed, boundary, 'boundary')).int(130, WORLD_WIDTH - 130); }
export function isBossChunk(index: number) { return index > 0 && (index + 1) % BOSS_INTERVAL === 0; }
export function bossOrdinalForChunk(index: number) { return Math.floor((index + 1) / BOSS_INTERVAL); }
export function contextFor(seed: number, chunkIndex: number, players: number): GenerationContext { return { seed, chunkIndex, players, difficulty: difficultyFor(chunkIndex), difficultyAxes: difficultyAxesFor(chunkIndex), biome: biomeForChunk(chunkIndex), rng(channel) { return createRandom(scopedSeed(seed, chunkIndex, channel)); } }; }
export function runtimeContext(context: GenerationContext, startedAt: number, now: number): RuntimeContext { return { ...context, startedAt, now }; }

function recipeFor(context: GenerationContext): ChunkRecipe { if (isBossChunk(context.chunkIndex)) return 'boss'; if ((context.chunkIndex + 2) % BOSS_INTERVAL === 0) return 'boss-buffer'; const r = context.rng('recipe').float(); return r < .14 ? 'reward' : r < .31 ? 'danger' : r < .45 ? 'mechanism' : 'normal'; }
function platform(id: string, x: number, y: number, width: number, optional = false): Platform { return { id, kind: 'normal', x: wrapX(x), y, width, optional }; }
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
function graphRoute(layers: Platform[][]) {
  const parents = new Map<string, Platform>();
  let reachable = new Set([layers[0]![0]!.id]);
  for (let layer = 1; layer < layers.length; layer += 1) {
    const next = new Set<string>();
    for (const candidate of layers[layer]!) {
      const parent = layers[layer - 1]!.find((item) => reachable.has(item.id) && canReachPlatform(item, candidate));
      if (parent) { parents.set(candidate.id, parent); next.add(candidate.id); }
    }
    reachable = next;
  }
  const exit = layers.at(-1)![0]!;
  if (!reachable.has(exit.id)) return null;
  const result = [exit];
  while (parents.has(result[0]!.id)) result.unshift(parents.get(result[0]!.id)!);
  return result;
}

function candidateCount(context: GenerationContext, rng: ReturnType<GenerationContext['rng']>) {
  const maximum = Math.max(2, 4 - Math.floor(context.difficultyAxes.sparsity * 2));
  const minimum = context.difficultyAxes.sparsity > .75 ? 1 : 2;
  return rng.int(minimum, maximum);
}

function generatePlatformField(context: GenerationContext, entryX: number, exitX: number, recipe: ChunkRecipe) {
  const baseY = context.chunkIndex * CHUNK_HEIGHT, sparsity = context.difficultyAxes.sparsity;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rng = context.rng(`field:${attempt}`), layerCount = sparsity > .72 ? 4 : 5, laneCount = candidateCount(context, rng);
    const entry = platform(`${context.chunkIndex}:field:entry`, entryX, baseY + 70, 220);
    const exit = platform(`${context.chunkIndex}:field:exit`, exitX, baseY + CHUNK_HEIGHT - 70, 220);
    const layers: Platform[][] = [[entry]];
    for (let layer = 1; layer <= layerCount; layer += 1) {
      const progress = layer / (layerCount + 1), y = Math.round(baseY + 70 + progress * (CHUNK_HEIGHT - 140) + rng.int(-22, 22));
      const width = laneCount >= 4 ? rng.int(105, 115) : rng.int(125, 150), fan = .9 + Math.sin(progress * Math.PI) * .1, candidates: Platform[] = [];
      const verticalOrder = Array.from({ length: laneCount }, (_, node) => ({ node, key: rng.float() })).sort((a, b) => a.key - b.key);
      const verticalRank = new Map(verticalOrder.map((item, rank) => [item.node, rank]));
      for (let node = 0; node < laneCount; node += 1) {
        const laneX = 70 + (node + .5) * (WORLD_WIDTH - 140) / laneCount;
        const centerX = entryX * (1 - progress) + exitX * progress + (laneX - WORLD_WIDTH / 2) * fan;
        const jitter = laneCount >= 4 ? 8 : 20;
        const stagger = (verticalRank.get(node)! - (laneCount - 1) / 2) * 56;
        candidates.push(platform(`${context.chunkIndex}:field:${layer}:${node}`, centerX + rng.int(-jitter, jitter), y + stagger + rng.int(-10, 10), width, true));
      }
      const previous = layers.at(-1)!;
      if (candidates.some((candidate, node) => !canReachPlatform(previous[Math.min(node, previous.length - 1)]!, candidate))) continue;
      layers.push(candidates);
    }
    if (layers.length !== layerCount + 1 || layers.at(-1)!.some((candidate) => !canReachPlatform(candidate, exit))) continue;
    layers.push([exit]);
    const route = graphRoute(layers);
    if (!route) continue;
    const routeIds = new Set(route.map((item) => item.id)), occupation = route.map(occupationBox), optional: Platform[] = [];
    const platformPool = [{ id: 'normal' as const, weight: 4 }, { id: 'fragile' as const, weight: 10 }, ...context.biome.content.platforms];
    for (const base of layers.slice(1, -1).flat().filter((item) => !routeIds.has(item.id))) {
      const pool = recipe === 'mechanism' ? platformPool.filter((item) => item.id === 'trigger' || item.id === 'spring') : platformPool;
      const kind = weightedFromPool(pool.length ? pool : platformPool, context.rng(`field-kind:${base.id}`).float());
      let candidate = platformStrategies.require(kind).generate({ ...base, optional: true, rewardMultiplier: recipe === 'danger' ? 1.75 : 1 }, context, optional.length);
      const trigger = candidate.config?.trigger;
      const bridges = trigger ? trigger.outputs.map((id, bridgeIndex) => ({ id, kind: 'bridge' as const, x: wrapX(candidate.x + (bridgeIndex + 1) * 155), y: candidate.y + 105 + bridgeIndex * 55, width: 145, optional: true, rewardMultiplier: candidate.rewardMultiplier })) : [];
      const boxes = [occupationBox(candidate), ...bridges.map(occupationBox)];
      if (boxes.some((box) => occupation.some((existing) => occupationOverlaps(box, existing)))) {
        candidate = { ...base, kind: 'normal', optional: true };
        const baseBox = occupationBox(candidate);
        if (!occupation.some((existing) => occupationOverlaps(baseBox, existing))) { optional.push(candidate); occupation.push(baseBox); }
      } else { optional.push(candidate, ...bridges); occupation.push(...boxes); }
    }
    return { route: route.map((item) => ({ ...item, optional: false })), optional };
  }
  const route = [platform(`${context.chunkIndex}:field:fallback:0`, entryX, baseY + 70, 220)];
  for (let i = 1; i <= 5; i += 1) route.push(platform(`${context.chunkIndex}:field:fallback:${i}`, entryX + (exitX - entryX) * i / 6, baseY + 70 + i * (CHUNK_HEIGHT - 140) / 6, 220));
  route.push(platform(`${context.chunkIndex}:field:fallback:6`, exitX, baseY + CHUNK_HEIGHT - 70, 220));
  return { route, optional: [] };
}

export function generateChunk(seed: number, index: number, players: number): Chunk {
  const context = contextFor(seed, index, players), recipe = recipeFor(context), entryX = boundaryX(seed, index), exitX = boundaryX(seed, index + 1);
  if (recipe === 'boss') {
    const strategy = bossForContext(context), platforms = strategy.arenaPlatforms(context), boss = strategy.create(context, 0, null);
    return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, difficultyAxes: context.difficultyAxes, recipe, boss: true, entryX, exitX, route: platforms.map((p) => p.id), platforms, enemies: [boss], pickups: [] };
  }
  const { route, optional } = generatePlatformField(context, entryX, exitX, recipe);
  const populated = recipe === 'boss-buffer' ? { enemies: [], pickups: [] } : encounterStrategies.require('mixed').populate(context, route, optional);
  const encounter = { ...populated, enemies: index < 2 ? [] : populated.enemies, pickups: index === 0 ? [] : populated.pickups };
  return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, difficultyAxes: context.difficultyAxes, recipe, boss: false, entryX, exitX, route: route.map((p) => p.id), platforms: [...route, ...optional], ...encounter };
}
export function findEntity(seed: number, players: number, id: string) { const index = Number(id.split(':')[0]); if (!Number.isInteger(index) || index < 0) return null; const chunk = generateChunk(seed, index, players); return chunk.platforms.find((x) => x.id === id) ?? chunk.enemies.find((x) => x.id === id) ?? chunk.pickups.find((x) => x.id === id) ?? null; }
export function transitionedState(platform: Platform, state: DynamicEntityState | undefined, context: RuntimeContext) { return platformStrategies.require(platform.kind).transition(platform, context, state); }
export function platformActive(platform: Platform, state: Record<string, DynamicEntityState>, context: RuntimeContext, bossDefeated: boolean) { if (platform.kind === 'boss-exit') return bossDefeated; const current = transitionedState(platform, state[platform.id], context); if (platform.kind === 'bridge') return current?.kind === 'platform' && current.phase === 'active' && (current.until == null || current.until > context.now); return current?.kind !== 'platform' || current.phase === 'active' || current.phase === 'warning' || current.phase === 'breaking'; }
export function platformPosition(platform: Platform, context: RuntimeContext) { const m = platform.config?.movement; if (!m) return { x: platform.x, y: platform.y }; const elapsed = Math.max(0, context.now - context.startedAt - (m.delayMs ?? 0)); if (!elapsed) return { x: platform.x, y: platform.y }; const travel = Math.max(1, m.periodMs - (m.pauseMs ?? 0) * 2), within = elapsed % m.periodMs; const normalized = within < (m.pauseMs ?? 0) ? 0 : within > travel + (m.pauseMs ?? 0) ? 1 : (within - (m.pauseMs ?? 0)) / travel; const offset = Math.sin(normalized * Math.PI * 2 + m.phase * Math.PI * 2) * m.range; if (m.axis === 'y') return { x: platform.x, y: platform.y + offset }; if (m.axis === 'path' && m.path?.length === 2) return { x: platform.x + (m.path[1]!.x - m.path[0]!.x) * ((Math.sin(normalized * Math.PI * 2 + m.phase * Math.PI * 2) + 1) / 2), y: platform.y + (m.path[1]!.y - m.path[0]!.y) * ((Math.sin(normalized * Math.PI * 2 + m.phase * Math.PI * 2) + 1) / 2) }; return { x: Math.max(0, Math.min(WORLD_WIDTH, platform.x + offset)), y: platform.y }; }
