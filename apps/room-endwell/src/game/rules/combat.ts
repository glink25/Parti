import type { Combatant, DamageElement, ElementStatusType, GameEvent, GameState, HitEvent, HitResolution, TargetingSpec } from '../contracts';

const STATUS_THRESHOLD = 100;
function relation(source: Combatant, target: Combatant) { return source.faction.id === target.faction.id || source.faction.team === target.faction.team ? 'ally' : 'enemy'; }
export function canTarget(sourceId: string, targetId: string, source: Combatant, target: Combatant, spec: TargetingSpec) { if (sourceId === targetId) return spec.canHitSelf; if (target.faction.team === 'neutral' || target.faction.team === 'environment') return spec.canHitNeutral; return relation(source, target) === 'ally' ? spec.canHitAllies : spec.canHitEnemies; }
function consume(target: Combatant, status: ElementStatusType) { delete target.statuses[status]; target.buildup[status] = 0; }
function status(target: Combatant, type: ElementStatusType, now: number, sourceId?: string, duration = 3000) { target.statuses[type] = { type, endsAt: now + duration, potency: 1, stacks: 1, sourceId, tags: [] }; }
export function applyHit(state: GameState, hit: HitEvent, now: number): HitResolution {
  if (state.seen.hits[hit.hitId]) return { accepted: false, events: [] };
  const sourceEntity = state.entities[hit.sourceId], owner = hit.ownerId ? state.players[hit.ownerId] ?? state.entities[hit.ownerId] : sourceEntity, target = state.players[hit.targetId] ?? state.entities[hit.targetId], hasDamage = Object.values(hit.payload.damage ?? {}).some((amount) => (amount ?? 0) > 0), hasHeal = (hit.payload.heal ?? 0) > 0;
  if (!owner || !target || hasDamage && (!target.damageable.canReceiveDamage || target.damageable.invincible) || hasHeal && !target.damageable.canReceiveHeal || !canTarget(hit.ownerId ?? hit.sourceId, hit.targetId, owner, target, sourceEntity?.source?.spell.targeting ?? { canHitSelf: false, canHitAllies: false, canHitEnemies: true, canHitNeutral: true })) return { accepted: false, events: [] };
  state.seen.hits[hit.hitId] = true; const events: GameEvent[] = [], damage = { ...(hit.payload.damage ?? {}) }; let reaction: string | null = null;
  if (target.statuses.wet && damage.lightning) { damage.lightning *= 1.25; status(target, 'shocked', now, hit.ownerId, 1200); reaction = 'electro-charged'; if (target.cast.phase !== 'idle') target.cast = { ...target.cast, phase: 'interrupted', phaseEndsAt: now + 350 }; }
  else if (target.statuses.wet && damage.fire) { damage.fire *= 1.4; consume(target, 'wet'); reaction = 'vaporize'; }
  else if (target.statuses.wet && damage.ice) { consume(target, 'wet'); status(target, 'frozen', now, hit.ownerId, 2000); reaction = 'freeze'; }
  else if (target.statuses.burning && damage.water) { consume(target, 'burning'); status(target, 'wet', now, hit.ownerId, 5000); reaction = 'extinguish'; }
  if (target.statuses.frozen && ((damage.rock ?? 0) > 0 || (damage.physical ?? 0) > 0)) { damage.rock = (damage.rock ?? 0) + 20; consume(target, 'frozen'); reaction = 'shatter'; }
  else if (target.statuses.frozen && damage.fire) { consume(target, 'frozen'); reaction ??= 'thaw'; }
  const targetEntity = state.entities[hit.targetId]; if (targetEntity?.obstacle?.material === 'ice' && damage.fire) damage.fire *= 1.5;
  if (reaction) events.push({ type: 'reaction_triggered', id: reaction, targetId: hit.targetId });
  for (const [element, raw] of Object.entries(damage) as Array<[DamageElement, number]>) { const resisted = raw * (1 - Math.max(-1, Math.min(.9, target.resistances[element] ?? 0))); let remaining = resisted; for (const shield of [...target.shields].sort((a, b) => b.priority - a.priority)) { const absorbed = Math.min(shield.amount, remaining * (shield.absorbElements[element] ?? 0)); shield.amount -= absorbed; remaining -= absorbed; } target.shields = target.shields.filter((shield) => shield.amount > 0); if (remaining > 0) { target.health.current = Math.max(0, target.health.current - remaining); events.push({ type: 'damage_applied', targetId: hit.targetId, amount: remaining, element }); } }
  if (hasHeal) { const amount = Math.min(hit.payload.heal!, target.health.max - target.health.current); if (amount > 0) { target.health.current += amount; events.push({ type: 'heal_applied', targetId: hit.targetId, amount }); } }
  for (const effect of hit.payload.effects ?? []) if (effect.type === 'interrupt' && target.cast.phase !== 'idle') target.cast = { ...target.cast, phase: 'interrupted', phaseEndsAt: now + 350 };
  for (const [key, amount] of Object.entries(hit.payload.statusBuildup ?? {})) { const type = key as ElementStatusType; target.buildup[type] = (target.buildup[type] ?? 0) + (amount ?? 0); if ((target.buildup[type] ?? 0) >= STATUS_THRESHOLD) { target.buildup[type] = 0; status(target, type, now, hit.ownerId, type === 'shocked' ? 1200 : type === 'chilled' ? 3000 : 5000); events.push({ type: 'status_applied', targetId: hit.targetId, status: type }); } }
  return { accepted: true, events };
}
