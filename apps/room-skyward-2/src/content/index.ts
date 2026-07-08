import { BOSS_SPAWN_Y_MAX, BOSS_SPAWN_Y_MIN, CHUNK_HEIGHT, WORLD_WIDTH, type ActiveEffect, type AttackDefinition, type BiomeDefinition, type BossPhaseDefinition, type BossStrategy, type ContactResult, type DynamicEntityState, type EncounterStrategy, type Enemy, type EnemyKind, type EnemyStrategy, type GenerationContext, type PickupKind, type PickupStrategy, type Platform, type PlatformKind, type PlatformStrategy, type RuntimeContext, type RuntimeEffect } from '../game/contracts';
import { Registry, contentFingerprint as fingerprint } from '../game/registry';
import { wrapX } from '../runtime/physics';

// Kept local to avoid a contracts -> physics dependency.
const NORMAL_BOUNCE = 1080;
const colors: Record<PlatformKind, string> = { normal: '#68d8d6', moving: '#59c3ff', fragile: '#d5b895', recovering: '#c57bff', spikes: '#ff5577', trigger: '#46e0b3', bridge: '#46e0b3', spring: '#ffe16a', 'boss-exit': '#ffd35a' };
const none = (): ContactResult => ({ effects: [] });

export const biomes = new Registry<BiomeDefinition>();
biomes.register({ id: 'aurora', name: '极光层', background: '#101c3d', platform: '#68d8d6', accent: '#b9f5ff', content: { environment: 'calm', platforms: [{ id: 'moving', weight: 4 }, { id: 'recovering', weight: 3 }, { id: 'fragile', weight: 1 }, { id: 'spikes', weight: 1 }, { id: 'trigger', weight: 2 }, { id: 'spring', weight: 2 }], enemies: [{ id: 'sentry', weight: 3 }, { id: 'patroller', weight: 3 }, { id: 'charger', weight: 1 }], pickups: pickupPool(), bosses: [{ id: 'mechanical-core', weight: 5 }, { id: 'sky-behemoth', weight: 2 }, { id: 'storm-warden', weight: 1 }] } });
biomes.register({ id: 'garden', name: '浮空花园', background: '#102f2a', platform: '#80d86b', accent: '#e3ff8b', content: { environment: 'updraft', platforms: [{ id: 'spring', weight: 4 }, { id: 'trigger', weight: 3 }, { id: 'moving', weight: 2 }, { id: 'recovering', weight: 2 }, { id: 'fragile', weight: 1 }, { id: 'spikes', weight: 1 }], enemies: [{ id: 'floater', weight: 4 }, { id: 'occupier', weight: 3 }, { id: 'patroller', weight: 1 }], pickups: pickupPool(), bosses: [{ id: 'sky-behemoth', weight: 5 }, { id: 'mechanical-core', weight: 2 }, { id: 'storm-warden', weight: 1 }] } });
biomes.register({ id: 'storm', name: '雷暴层', background: '#24183f', platform: '#b18cff', accent: '#ffe66d', content: { environment: 'storm', platforms: [{ id: 'spikes', weight: 4 }, { id: 'fragile', weight: 3 }, { id: 'moving', weight: 2 }, { id: 'recovering', weight: 1 }, { id: 'trigger', weight: 1 }, { id: 'spring', weight: 1 }], enemies: [{ id: 'sentry', weight: 4 }, { id: 'charger', weight: 3 }, { id: 'floater', weight: 2 }], pickups: pickupPool(), bosses: [{ id: 'storm-warden', weight: 5 }, { id: 'sky-behemoth', weight: 2 }, { id: 'mechanical-core', weight: 1 }] } });

function pickupPool() { return ([['shield', 2], ['rapid', 3], ['power', 2], ['spread', 1], ['pierce', 1], ['rocket', 1], ['propeller', 2], ['super-jump', 2], ['slow-fall', 2]] as const).map(([id, weight]) => ({ id, weight })); }
function runtimeEffect(entityId: string, state: DynamicEntityState): RuntimeEffect { return { kind: 'entity-state', entityId, state }; }
function basePlatform(id: PlatformKind, safe: boolean, weight: number, generate: PlatformStrategy['generate'] = (p) => ({ ...p, kind: id }), contact: PlatformStrategy['contact'] = () => ({ bounceVelocity: NORMAL_BOUNCE, effects: [] })): PlatformStrategy {
  return { id, version: 1, safe, weight, generate: (p, c, i) => generate({ ...p, kind: id }, c, i), contact, transition: (p, c, state) => transitionPlatform(p, c, state), render: (p, c, state) => renderPlatform(p, c, state) };
}
export const platformStrategies = new Registry<PlatformStrategy>();
platformStrategies.register(basePlatform('normal', true, 5));
platformStrategies.register(basePlatform('moving', false, 2, (p, c, i) => { const r = c.rng(`moving:${i}`); const axis = r.pick(['x', 'y', 'path'] as const); return { ...p, config: { movement: { axis, range: r.int(60, 135), periodMs: r.int(2200, 4000), phase: r.float(), delayMs: r.int(0, 1200), pauseMs: r.int(0, 500), path: axis === 'path' ? [{ x: p.x, y: p.y }, { x: wrapX(p.x + r.int(-130, 130)), y: p.y + r.int(-50, 90) }] : undefined } } }; }));
platformStrategies.register(basePlatform('fragile', false, 1.4, (p, c, i) => { const r = c.rng(`fragile:${i}`); return { ...p, config: { breakDelayMs: r.int(220, 650), warningMs: 180, recoverMs: r.float() < .45 ? r.int(3200, 5200) : 0 } }; }, (p, c, state) => state?.kind === 'platform' && state.phase !== 'active' ? none() : ({ bounceVelocity: NORMAL_BOUNCE, effects: [runtimeEffect(p.id, { kind: 'platform', phase: 'warning', changedAt: c.now, until: c.now + (p.config?.breakDelayMs ?? 350) })] })));
platformStrategies.register(basePlatform('recovering', false, 1.5, (p, c, i) => { const r = c.rng(`recover:${i}`); return { ...p, config: { breakDelayMs: 320, warningMs: 320, recoverMs: r.int(2800, 4200) } }; }, (p, c, state) => state?.kind === 'platform' && state.phase !== 'active' ? none() : ({ bounceVelocity: NORMAL_BOUNCE, effects: [runtimeEffect(p.id, { kind: 'platform', phase: 'warning', changedAt: c.now, until: c.now + 320 })] })));
platformStrategies.register(basePlatform('spikes', false, 1.1, (p, c, i) => { const r = c.rng(`spike:${i}`); return { ...p, config: { spike: { start: r.float() * .35, end: .65 + r.float() * .35, periodMs: r.int(2600, 4200), warningMs: 500, activeMs: 1100, phase: r.float() } } }; }, (p, c) => spikeActive(p, c) ? ({ damageReason: '尖刺', effects: [] }) : ({ bounceVelocity: NORMAL_BOUNCE, effects: [] })));
platformStrategies.register(basePlatform('trigger', false, .8, (p, c, i) => { const r = c.rng(`trigger:${i}`); const outputCount = r.int(1, 3); return { ...p, config: { trigger: { mode: r.pick(['permanent', 'timed', 'sequence'] as const), durationMs: r.int(6500, 10000), requiredHits: r.int(2, 3), resetMs: 4000, outputs: Array.from({ length: outputCount }, (_, n) => `${p.id}:output:${n}`) } } }; }, (p, c, state) => { const cfg = p.config!.trigger!; const previous = state?.kind === 'trigger' && (state.until == null || state.until > c.now) ? state.count : 0; const count = Math.min(cfg.requiredHits, previous + 1); const active = cfg.mode !== 'sequence' || count >= cfg.requiredHits; const until = cfg.mode === 'permanent' && active ? null : c.now + (active ? cfg.durationMs : cfg.resetMs); return { bounceVelocity: NORMAL_BOUNCE, effects: [runtimeEffect(p.id, { kind: 'trigger', count, activatedAt: active ? c.now : 0, until }), ...cfg.outputs.map((id) => runtimeEffect(id, { kind: 'platform', phase: active ? 'active' : 'hidden', changedAt: c.now, until }))] }; }));
platformStrategies.register(basePlatform('bridge', false, 0));
platformStrategies.register(basePlatform('spring', false, 1.2, (p) => ({ ...p, config: { spring: { start: .28, end: .72, velocity: 1350 } } }), (p) => ({ bounceVelocity: p.config?.spring?.velocity ?? 1350, effects: [] })));
platformStrategies.register(basePlatform('boss-exit', false, 0));

function transitionPlatform(p: Platform, c: RuntimeContext, state?: DynamicEntityState): DynamicEntityState | null {
  if (state?.kind !== 'platform' || state.phase === 'active') return state ?? null;
  const breakDelay = p.config?.breakDelayMs ?? 0, recover = p.config?.recoverMs ?? 0, restoreWarning = p.config?.warningMs ?? 500, elapsed = c.now - state.changedAt;
  if (elapsed < breakDelay) return { ...state, phase: 'warning', until: state.changedAt + breakDelay };
  if (!recover) return { ...state, phase: 'hidden', until: null };
  if (elapsed < breakDelay + recover) return { ...state, phase: 'hidden', until: state.changedAt + breakDelay + recover };
  if (elapsed < breakDelay + recover + restoreWarning) return { ...state, phase: 'restoring', until: state.changedAt + breakDelay + recover + restoreWarning };
  return { ...state, phase: 'active', until: null };
}
function spikeActive(p: Platform, c: RuntimeContext) { const s = p.config?.spike; if (!s) return false; const t = ((c.now - c.startedAt + s.phase * s.periodMs) % s.periodMs + s.periodMs) % s.periodMs; return t >= s.warningMs && t < s.warningMs + s.activeMs; }
function renderPlatform(p: Platform, c: RuntimeContext, state?: DynamicEntityState) { const phase = state?.kind === 'platform' ? state.phase : 'active'; const warning = phase === 'warning' || phase === 'restoring' || (p.kind === 'spikes' && !spikeActive(p, c)); return { color: colors[p.kind], label: p.kind, warning, hidden: phase === 'hidden', spikeRange: p.config?.spike ? [p.config.spike.start, p.config.spike.end] as [number, number] : undefined }; }

const attacks: Record<string, AttackDefinition> = {
  shot: { id: 'shot', kind: 'shot', warningMs: 700, activeMs: 700, cooldownMs: 2800, radius: 36 }, charge: { id: 'charge', kind: 'charge', warningMs: 700, activeMs: 500, cooldownMs: 3400, radius: 70 },
};
function enemy(id: EnemyKind, weight: number, hp: number, stompable: boolean, controller: Enemy['controller'], attackList: AttackDefinition[] = [], boss = false): EnemyStrategy {
  return {
    id, version: 1, weight, boss,
    create(c, i, anchor) { const r = c.rng(`enemy:${id}:${i}`), strength = c.difficultyAxes.enemyStrength; return { id: `${c.chunkIndex}:enemy:${id}:${i}`, kind: id, x: anchor?.x ?? r.int(90, 810), y: (anchor?.y ?? c.chunkIndex * CHUNK_HEIGHT + (boss ? r.int(BOSS_SPAWN_Y_MIN, BOSS_SPAWN_Y_MAX) : r.int(260, 1380))) + (anchor ? 54 : 0), hp: Math.ceil(hp * (1 + strength * .9)), radius: boss ? 105 : 34, boss, stompable, controller: tuneController(controller, r.float(), anchor), attacks: attackList, drops: [{ pickup: 'shield', weight: 1 }, { pickup: 'rapid', weight: 2 }], anchorId: anchor?.id }; },
    position(e, c) { return enemyPosition(e, c); }, contact(e) { return e.stompable ? { effects: [] } : { damageReason: '不可踩踏怪物', effects: [] }; },
    hit(e, damage) { return [{ kind: 'damage', targetId: e.id, amount: damage }]; }, attack(e, _context, sequence) { return e.attacks.length ? e.attacks[sequence % e.attacks.length]! : null; },
    death(e, c) { const r = c.rng(`drop:${e.id}`); return r.float() < .35 ? [{ kind: 'message', text: '怪物掉落奖励' }] : []; },
  };
}
function tuneController(c: Enemy['controller'], phase: number, anchor: Platform | null): Enemy['controller'] { if (c.kind === 'stationary') return c; if (c.kind === 'occupy') return { ...c, platformId: anchor?.id ?? c.platformId, phase }; return { ...c, phase }; }
export function enemyPosition(e: Enemy, c: RuntimeContext) { const control = e.controller; if (control.kind === 'stationary' || control.kind === 'occupy') return { x: e.x, y: e.y }; const t = (c.now - c.startedAt) / control.periodMs * Math.PI * 2 + control.phase * Math.PI * 2, offset = Math.sin(t) * control.range; if (control.kind === 'charge') return { x: Math.max(0, Math.min(WORLD_WIDTH, e.x + Math.max(0, offset) * Math.sign(Math.cos(t)))), y: e.y }; return control.axis === 'x' ? { x: Math.max(0, Math.min(WORLD_WIDTH, e.x + offset)), y: e.y } : { x: e.x, y: e.y + offset }; }
export const enemyStrategies = new Registry<EnemyStrategy>();
enemyStrategies.register(enemy('sentry', 3, 1, true, { kind: 'stationary' }, [attacks.shot!]));
enemyStrategies.register(enemy('floater', 2, 1, true, { kind: 'float', axis: 'y', range: 70, periodMs: 3000, phase: 0 }, [attacks.shot!]));
enemyStrategies.register(enemy('patroller', 2, 2, true, { kind: 'patrol', axis: 'x', range: 130, periodMs: 3200, phase: 0 }));
enemyStrategies.register(enemy('charger', 1.5, 2, false, { kind: 'charge', range: 180, periodMs: 3800, warningMs: 700, phase: 0 }, [attacks.charge!]));
enemyStrategies.register(enemy('occupier', 1.5, 2, true, { kind: 'occupy', platformId: '', periodMs: 4000, openMs: 1600, phase: 0 }));

export const pickupStrategies = new Registry<PickupStrategy>();
for (const [id, weight, durationMs] of [['shield', 1.2, 0], ['rapid', 1.4, 12000], ['power', 1.2, 14000], ['spread', .65, 10000], ['pierce', .65, 10000], ['rocket', .7, 4200], ['propeller', .9, 5000], ['super-jump', 1, 12000], ['slow-fall', 1, 12000]] as const) {
  pickupStrategies.register({ id, version: 1, weight, durationMs, create(c, i, anchor) { return { id: `${c.chunkIndex}:pickup:${id}:${i}`, kind: id, x: anchor.x, y: anchor.y + 70, durationMs }; }, claim(p, c) { return [{ kind: 'apply-effect', effect: effectFor(p.kind, p.id, p.durationMs, c.now) }]; }, refresh(current, p, now) { return { ...current, startedAt: now, endsAt: p.kind === 'shield' ? null : now + p.durationMs, stacks: 1, sourceId: p.id, phase: 'starting' }; }, end(effect) { return effect.id === 'rocket' || effect.id === 'propeller' ? [{ kind: 'message', text: '飞行结束，正在缓降' }] : []; }, hud(effect, now) { return effect.endsAt == null ? `${effect.id} ×1` : `${effect.id} ${Math.max(0, Math.ceil((effect.endsAt - now) / 1000))}s`; } });
}
export function effectFor(id: PickupKind, sourceId: string, durationMs: number, now: number): ActiveEffect { return { id, startedAt: now, endsAt: id === 'shield' ? null : now + durationMs, stacks: 1, sourceId, phase: 'starting' }; }

const bossPhases = (attacks: BossPhaseDefinition['attacks']): BossPhaseDefinition[] => [{ id: 'phase-1', minHpRatio: .6, warningScale: 1, cooldownScale: 1, attacks }, { id: 'phase-2', minHpRatio: .3, warningScale: .82, cooldownScale: .88, attacks }, { id: 'phase-3', minHpRatio: 0, warningScale: .65, cooldownScale: .76, attacks }];
function boss(id: Extract<EnemyKind, 'storm-warden' | 'sky-behemoth' | 'mechanical-core'>, attackKinds: BossPhaseDefinition['attacks']): BossStrategy {
  const base = enemy(id, 0, 32, false, { kind: 'stationary' }, [], true);
  return { ...base, id, boss: true, phases: bossPhases(attackKinds), arenaPlatforms(c) { return bossArena(c); }, selectAttack(e, c, phase, sequence, target) { const picked = weightedKind(phase.attacks, c.rng(`boss-attack:${sequence}`).float()); const warning = Math.round(({ lightning: 1900, 'lock-zone': 1500, 'platform-hazard': 1500, summon: 1100, slam: 1400, 'tilt-zone': 1500, laser: 1600, 'platform-toggle': 1200 } as Record<string, number>)[picked] * phase.warningScale); const active = picked === 'lock-zone' ? 2600 : picked === 'laser' ? 1500 : 800; const now = c.now; return { id: `${e.id}:attack:${sequence}`, kind: picked, x: target?.x ?? WORLD_WIDTH / 2, y: target?.y ?? c.chunkIndex * CHUNK_HEIGHT + 720, radius: picked === 'lightning' ? 90 : 130, startedAt: now, activeAt: now + warning, endsAt: now + warning + active, direction: picked === 'laser' ? c.rng(`laser:${sequence}`).pick(['up', 'down', 'left', 'right'] as const) : undefined }; }, summons(_e, c, sequence) { return id === 'storm-warden' ? [enemyStrategies.require('floater').create(c, 1000 + sequence, null)] : []; }, victory(e) { return [{ kind: 'message', text: `${e.kind} 已击败` }]; } };
}
export const stormWarden = boss('storm-warden', [{ id: 'lightning', weight: 4 }, { id: 'lock-zone', weight: 3 }, { id: 'summon', weight: 2 }]);
export const skyBehemoth = boss('sky-behemoth', [{ id: 'slam', weight: 4 }, { id: 'tilt-zone', weight: 3 }, { id: 'platform-hazard', weight: 2 }]);
export const mechanicalCore = boss('mechanical-core', [{ id: 'laser', weight: 4 }, { id: 'platform-toggle', weight: 3 }, { id: 'platform-hazard', weight: 2 }]);
mechanicalCore.phases[1]!.weak = true;
enemyStrategies.register(stormWarden); enemyStrategies.register(skyBehemoth); enemyStrategies.register(mechanicalCore);
export const bossStrategies = new Registry<BossStrategy>(); bossStrategies.register(stormWarden); bossStrategies.register(skyBehemoth); bossStrategies.register(mechanicalCore);

function bossArena(c: GenerationContext) { const base = c.chunkIndex * CHUNK_HEIGHT; const r = c.rng('boss-arena'); const middle = r.int(380, 520); const points = [[c.chunkIndex + ':boss:entry', middle, 120, 280, 'normal'], [c.chunkIndex + ':boss:left', r.int(170, 280), 340, 190, 'normal'], [c.chunkIndex + ':boss:right', r.int(620, 730), 520, 190, 'normal'], [c.chunkIndex + ':boss:arena', middle, 710, 360, 'normal'], [c.chunkIndex + ':boss:exit0', middle, 900, 220, 'boss-exit'], [c.chunkIndex + ':boss:exit1', r.int(580, 700), 1090, 190, 'boss-exit'], [c.chunkIndex + ':boss:exit2', r.int(260, 430), 1280, 190, 'boss-exit'], [c.chunkIndex + ':boss:top', middle, 1530, 240, 'boss-exit']] as const; return points.map(([id, x, y, width, kind]) => ({ id, kind, x, y: base + y, width, optional: false } satisfies Platform)); }
function weightedKind<T extends string>(items: readonly { id: T; weight: number }[], value: number): T { const total = items.reduce((n, i) => n + i.weight, 0); let cursor = value * total; for (const item of items) { cursor -= item.weight; if (cursor <= 0) return item.id; } return items.at(-1)!.id; }
export function weightedFromPool<T extends string>(items: readonly { id: T; weight: number }[], value: number) { return weightedKind(items, value); }

export const encounterStrategies = new Registry<EncounterStrategy>();
encounterStrategies.register({ id: 'mixed', version: 1, populate(context, route, optional) { const enemies: Enemy[] = [], pickups = []; const r = context.rng('encounter'); const safe = optional.filter((a) => route.every((p) => Math.abs(a.y - p.y) > 250 || Math.abs(a.x - p.x) > p.width / 2 + a.width / 2 + 90)); const count = Math.min(safe.length, Math.round(context.difficultyAxes.enemyDensity * 3)); for (let i = 0; i < count; i += 1) { const id = weightedFromPool(context.biome.content.enemies, context.rng(`enemy-kind:${i}`).float()); enemies.push(enemyStrategies.require(id).create(context, i, safe[i]!)); } if (r.float() < .72) { const id = weightedFromPool(context.biome.content.pickups, context.rng('pickup-kind').float()); pickups.push(pickupStrategies.require(id).create(context, 0, optional[0] ?? route[Math.floor(route.length / 2)]!)); } return { enemies, pickups }; } });

export function biomeForChunk(index: number) { return biomes.values()[Math.floor(index / 10) % biomes.values().length]!; }
export function strategyForPlatform(id: PlatformKind) { return platformStrategies.require(id); }
export function bossForContext(c: GenerationContext) { return bossStrategies.require(weightedFromPool(c.biome.content.bosses, c.rng('boss-kind').float())); }
export const CONTENT_FINGERPRINT = fingerprint([biomes, platformStrategies, enemyStrategies, pickupStrategies, bossStrategies, encounterStrategies], ['biome', 'platform', 'enemy', 'pickup', 'boss', 'encounter']);
