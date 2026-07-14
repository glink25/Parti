import type { DamageElement, EntityState, GameEvent, Vec2 } from '../game/contracts';

export type MonsterVisual = 'chaser' | 'shooter' | 'guardian' | 'boss';
export type MonsterHitSnapshot = { monsterId: string; position: Vec2; direction: Vec2; damage: number; maxHealth: number; radius: number; element: DamageElement; elite: boolean; boss: boolean; visual: MonsterVisual; flip: boolean };
export type MonsterFragment = { offset: Vec2; velocity: Vec2; size: number; rotation: number; angularVelocity: number; flightTime: number; landingY: number; vertices: number[] };
export type MonsterDeathEffect = { id: string; position: Vec2; element: DamageElement; visual: MonsterVisual; flip: boolean; createdAt: number; duration: number; strength: number; fragments: MonsterFragment[] };
export type SampledMonsterFragment = { position: Vec2; textureOffset: Vec2; size: number; rotation: number; alpha: number; vertices: number[] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalized = (value: Vec2) => { const length = Math.hypot(value.x, value.y) || 1; return { x: value.x / length, y: value.y / length }; };
function random(seed: number) { let state = seed >>> 0 || 1; return () => { state = Math.imul(state ^ state >>> 15, 1 | state); state ^= state + Math.imul(state ^ state >>> 7, 61 | state); return ((state ^ state >>> 14) >>> 0) / 0x100000000; }; }
function hash(value: string) { let result = 2166136261; for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); } return result >>> 0; }

export function createMonsterHitSnapshot(monster: EntityState, sourcePosition: Vec2 | null, hitPosition: Vec2, event: Extract<GameEvent, { type: 'damage_applied' }>): MonsterHitSnapshot {
  const base = sourcePosition ? { x: hitPosition.x - sourcePosition.x, y: hitPosition.y - sourcePosition.y } : { x: -(monster.direction?.x ?? 1), y: -(monster.direction?.y ?? 0) }, jitter = sourcePosition ? 0 : (hash(`${monster.id}:${Math.round(event.amount)}`) % 31 - 15) * Math.PI / 180, angle = Math.atan2(base.y, base.x) + jitter;
  const visual: MonsterVisual = monster.boss ? 'boss' : monster.monsterDefinitionId === 'ruins.shooter' ? 'shooter' : monster.monsterDefinitionId === 'ruins.guardian' ? 'guardian' : 'chaser';
  return { monsterId: monster.id, position: { ...hitPosition }, direction: { x: Math.cos(angle), y: Math.sin(angle) }, damage: event.amount, maxHealth: monster.health.max, radius: monster.radius, element: event.element, elite: Boolean(monster.elite), boss: Boolean(monster.boss), visual, flip: (monster.direction?.x ?? -1) > 0 };
}

export function createMonsterDeathEffect(snapshot: MonsterHitSnapshot, seed: number, createdAt: number): MonsterDeathEffect {
  const rng = random(seed), direction = normalized(snapshot.direction), strength = clamp(snapshot.damage / Math.max(1, snapshot.maxHealth), .08, 2.5), bodyBonus = snapshot.boss ? 6 : snapshot.elite ? 2 : 0, count = Math.min(20, 7 + Math.round(strength * 5) + bodyBonus), dimensions = visualDimensions(snapshot.visual), columns = Math.ceil(Math.sqrt(count * dimensions.width / dimensions.height)), rows = Math.ceil(count / columns), cellWidth = dimensions.width / columns, cellHeight = dimensions.height / rows, duration = Math.min(1900, 1450 + strength * 140 + (snapshot.boss ? 120 : 0)), fragments: MonsterFragment[] = [];
  for (let index = 0; index < count; index++) { const column = index % columns, row = Math.floor(index / columns), offset = { x: -dimensions.width / 2 + cellWidth * (column + .5) + (rng() - .5) * cellWidth * .18, y: -dimensions.height / 2 + cellHeight * (row + .5) + dimensions.anchor + (rng() - .5) * cellHeight * .18 }, spread = (rng() - .5) * Math.PI * (1.05 + strength * .22), angle = Math.atan2(direction.y, direction.x) + spread, radial = 35 + rng() * (75 + strength * 45), directional = 85 + strength * 95 + rng() * 55, flightTime = .44 + rng() * .24 + Math.min(.12, strength * .04), landingY = dimensions.height / 2 + dimensions.anchor - Math.min(3, rng() * 5), gravity = 620, velocityY = (landingY - offset.y - gravity * flightTime * flightTime / 2) / flightTime, vertices = Array.from({ length: 5 }, () => .76 + rng() * .35); fragments.push({ offset, velocity: { x: direction.x * directional + Math.cos(angle) * radial, y: velocityY }, size: Math.max(cellWidth, cellHeight) * (.66 + rng() * .12), rotation: rng() * Math.PI * 2, angularVelocity: (rng() - .5) * (7 + strength * 5), flightTime, landingY, vertices }); }
  return { id: snapshot.monsterId, position: { ...snapshot.position }, element: snapshot.element, visual: snapshot.visual, flip: snapshot.flip, createdAt, duration, strength, fragments };
}

export function sampleMonsterDeathEffect(effect: MonsterDeathEffect, now: number): SampledMonsterFragment[] {
  const elapsed = clamp((now - effect.createdAt) / 1000, 0, effect.duration / 1000), progress = clamp((now - effect.createdAt) / effect.duration, 0, 1), alpha = progress < .68 ? 1 : 1 - (progress - .68) / .32, scale = progress < .68 ? 1 : .38 + alpha * .62, gravity = 620;
  return effect.fragments.map((fragment) => { const flight = Math.min(elapsed, fragment.flightTime), landed = elapsed >= fragment.flightTime, x = fragment.offset.x + fragment.velocity.x * flight, y = landed ? fragment.landingY : fragment.offset.y + fragment.velocity.y * flight + gravity * flight * flight / 2, rotation = fragment.rotation + fragment.angularVelocity * flight; return { position: { x: effect.position.x + x, y: effect.position.y + y }, textureOffset: fragment.offset, size: fragment.size * scale, rotation, alpha: clamp(alpha, 0, 1), vertices: fragment.vertices }; });
}

export function monsterDeathFinished(effect: MonsterDeathEffect, now: number) { return now >= effect.createdAt + effect.duration; }

function visualDimensions(visual: MonsterVisual) { if (visual === 'boss') return { width: 142, height: 142, anchor: 12 }; if (visual === 'guardian') return { width: 78, height: 78, anchor: 6 }; if (visual === 'shooter') return { width: 66, height: 72, anchor: 2 }; return { width: 70, height: 62, anchor: 5 }; }
