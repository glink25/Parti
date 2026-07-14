import type { Combatant, DamageElement, ElementStatusType, EntityState, GameEvent, GameState, HitEvent, HitResolution, PlayerState, TargetingSpec, Vec2 } from '../contracts';
import { damageMultiplier } from './equipment';

const STATUS_THRESHOLD = 100;
const MAX_FORCE_SPEED = 180;
const positionAt = (entity: EntityState, now: number): Vec2 => entity.velocity ? { x: entity.position.x + entity.velocity.x * Math.max(0, now - entity.createdAt) / 1000, y: entity.position.y + entity.velocity.y * Math.max(0, now - entity.createdAt) / 1000 } : entity.position;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
function clampLength(value: Vec2, max: number): Vec2 { const length = Math.hypot(value.x, value.y); return length > max ? { x: value.x / length * max, y: value.y / length * max } : value; }
function relation(source: Combatant, target: Combatant) { return source.faction.id === target.faction.id || source.faction.team === target.faction.team ? 'ally' : 'enemy'; }
export function canTarget(sourceId: string, targetId: string, source: Combatant, target: Combatant, spec: TargetingSpec) { if (sourceId === targetId) return spec.canHitSelf; if (target.faction.team === 'neutral' || target.faction.team === 'environment') return spec.canHitNeutral; return relation(source, target) === 'ally' ? spec.canHitAllies : spec.canHitEnemies; }
function consume(target: Combatant, status: ElementStatusType) { delete target.statuses[status]; target.buildup[status] = 0; }
function status(target: Combatant, type: ElementStatusType, now: number, sourceId?: string, duration = 3000) { target.statuses[type] = { type, endsAt: now + duration, potency: 1, stacks: 1, sourceId, tags: [] }; }
function immune(target: Combatant, type: ElementStatusType) { return type === 'burning' && target.statuses.fireWard || (type === 'chilled' || type === 'frozen') && target.statuses.frostWard || type === 'wet' && target.statuses.waterWard || type === 'shocked' && target.statuses.grounded; }
function movableTarget(state: GameState, id: string): PlayerState | EntityState | null { const player = state.players[id]; if (player) return player; const entity = state.entities[id]; return entity?.kind === 'monster' ? entity : null; }
function hasPosition(value: Combatant | undefined): value is Combatant & { position: Vec2 } { return Boolean(value && typeof (value as { position?: Vec2 }).position?.x === 'number' && typeof (value as { position?: Vec2 }).position?.y === 'number'); }
function fallbackDirection(source: EntityState, owner: Combatant | undefined, target: PlayerState | EntityState): Vec2 {
  if (source.direction) return source.direction;
  if (hasPosition(owner)) {
    const dx = target.position.x - owner.position.x, dy = target.position.y - owner.position.y, length = Math.hypot(dx, dy);
    if (length > .001) return { x: dx / length, y: dy / length };
  }
  return { x: 1, y: 0 };
}
function applyForce(state: GameState, source: EntityState, owner: Combatant | undefined, targetId: string, force: number, now: number) {
  const target = movableTarget(state, targetId);
  if (!target || !Number.isFinite(force) || force === 0) return;
  const sourcePosition = positionAt(source, now), dx = target.position.x - sourcePosition.x, dy = target.position.y - sourcePosition.y, length = Math.hypot(dx, dy);
  const direction = length > .001 ? { x: dx / length, y: dy / length } : fallbackDirection(source, owner, target);
  const radius = Math.max(1, source.radius), falloff = source.kind === 'field' ? clamp01(1 - length / radius) : 1;
  if (falloff <= 0) return;
  const dt = source.source?.tickMs ? source.source.tickMs / 1000 : .12, impulse = force * dt * falloff, current = target.forceVelocity ?? { x: 0, y: 0 };
  target.forceVelocity = clampLength({ x: current.x + direction.x * impulse, y: current.y + direction.y * impulse }, MAX_FORCE_SPEED);
}
export function applyHit(state: GameState, hit: HitEvent, now: number): HitResolution {
  if (state.seen.hits[hit.hitId]) return { accepted: false, events: [] };
  const sourceEntity = state.entities[hit.sourceId], owner = hit.ownerId ? state.players[hit.ownerId] ?? state.entities[hit.ownerId] : sourceEntity, target = state.players[hit.targetId] ?? state.entities[hit.targetId], hasDamage = Object.values(hit.payload.damage ?? {}).some((amount) => (amount ?? 0) > 0), hasHeal = (hit.payload.heal ?? 0) > 0;
  if (!owner || !target || 'alive' in owner && !owner.alive || 'alive' in target && !target.alive || hasHeal && !target.damageable.canReceiveHeal || !canTarget(hit.ownerId ?? hit.sourceId, hit.targetId, owner, target, sourceEntity?.source?.spell.targeting ?? { canHitSelf: false, canHitAllies: false, canHitEnemies: true, canHitNeutral: true })) return { accepted: false, events: [] };
  if (hasDamage && (!target.damageable.canReceiveDamage || target.damageable.invincible)) { state.seen.hits[hit.hitId] = true; return { accepted: true, events: [{ type: 'damage_immune', targetId: hit.targetId, reason: 'invincible' }] }; }
  state.seen.hits[hit.hitId] = true; const events: GameEvent[] = [], damage = { ...(hit.payload.damage ?? {}) }; let reaction: string | null = null;
  if (target.statuses.wet && damage.lightning) { damage.lightning *= 1.25; status(target, 'shocked', now, hit.ownerId, 1200); reaction = 'electro-charged'; if (target.cast.phase !== 'idle') target.cast = { ...target.cast, phase: 'interrupted', phaseEndsAt: now + 350 }; }
  else if (target.statuses.wet && damage.fire) { damage.fire *= 1.4; consume(target, 'wet'); reaction = 'vaporize'; }
  else if (target.statuses.wet && damage.ice) { consume(target, 'wet'); status(target, 'frozen', now, hit.ownerId, 2000); reaction = 'freeze'; }
  else if (target.statuses.burning && damage.water) { consume(target, 'burning'); status(target, 'wet', now, hit.ownerId, 5000); reaction = 'extinguish'; }
  if (target.statuses.frozen && ((damage.rock ?? 0) > 0 || (damage.physical ?? 0) > 0)) { damage.rock = (damage.rock ?? 0) + 20; consume(target, 'frozen'); reaction = 'shatter'; }
  else if (target.statuses.frozen && damage.fire) { consume(target, 'frozen'); reaction ??= 'thaw'; }
  const targetEntity = state.entities[hit.targetId]; if (targetEntity?.obstacle?.material === 'ice' && damage.fire) damage.fire *= 1.5;
  if (reaction) events.push({ type: 'reaction_triggered', id: reaction, targetId: hit.targetId });
  for (const [element, raw] of Object.entries(damage) as Array<[DamageElement, number]>) { const robeMultiplier = 'equipment' in target ? damageMultiplier(target.equipment, element) : 1, resisted = raw * robeMultiplier * (1 - Math.max(-1, Math.min(.9, target.resistances[element] ?? 0))); let remaining = resisted; for (const shield of [...target.shields].sort((a, b) => b.priority - a.priority)) { const absorbed = Math.min(shield.amount, remaining * (shield.absorbElements[element] ?? 0)); shield.amount -= absorbed; remaining -= absorbed; } target.shields = target.shields.filter((shield) => shield.amount > 0); if (remaining > 0) target.health.current = Math.max(0, target.health.current - remaining); events.push({ type: 'damage_applied', targetId: hit.targetId, amount: Math.max(0, remaining), element, sourceId: hit.sourceId, largeImpact: hit.tags.includes('large-impact') }); }
  if (hasHeal) { const amount = Math.min(hit.payload.heal!, target.health.max - target.health.current); if (amount > 0) { target.health.current += amount; events.push({ type: 'heal_applied', targetId: hit.targetId, amount }); } }
  for (const effect of hit.payload.effects ?? []) {
    if (effect.type === 'interrupt' && target.cast.phase !== 'idle') { const spellId = target.cast.spell?.id; target.cast = { ...target.cast, phase: 'interrupted', phaseEndsAt: now + 350 }; events.push({ type: 'cast_interrupted', casterId: hit.targetId, spellId, reason: 'control' }); }
    else if (effect.type === 'knockback' && sourceEntity) applyForce(state, sourceEntity, owner, hit.targetId, effect.force, now);
  }
  for (const [key, amount] of Object.entries(hit.payload.statusBuildup ?? {})) { const type = key as ElementStatusType; if (immune(target, type)) { target.buildup[type] = 0; events.push({ type: 'damage_immune', targetId: hit.targetId, reason: 'status' }); continue; } target.buildup[type] = (target.buildup[type] ?? 0) + (amount ?? 0); if ((target.buildup[type] ?? 0) >= STATUS_THRESHOLD) { target.buildup[type] = 0; status(target, type, now, hit.ownerId, type === 'shocked' ? 1200 : type === 'chilled' ? 3000 : 5000); events.push({ type: 'status_applied', targetId: hit.targetId, status: type }); } }
  return { accepted: true, events };
}
