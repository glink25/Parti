import type { Combatant, EntityState, GameState, Vec2 } from '../game/contracts';
import { canTarget } from '../game/rules/combat';
import { positionAt } from '../game/rules/entities';

export type CollisionTarget = { id: string; position: Vec2; radius: number; combatant: Combatant; kind: 'player' | EntityState['kind'] };
export type CollisionCandidate = { target: CollisionTarget; reason: 'hit' | 'blocked' };

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) { const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy; if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y); const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)); return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t)); }
function alongRay(origin: Vec2, direction: Vec2, point: Vec2) { return (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y; }

export function intersectsSource(source: EntityState, target: { position: Vec2; radius: number }, now: number, previous?: Vec2): boolean {
  const spell = source.source?.spell; if (!spell) return false; const position = positionAt(source, now);
  if (spell.delivery === 'projectile') return pointSegmentDistance(target.position, previous ?? position, position) <= source.radius + target.radius;
  if (spell.delivery === 'spray') { const origin = source.position, delta = { x: target.position.x - origin.x, y: target.position.y - origin.y }, distance = Math.hypot(delta.x, delta.y); if (distance > spell.range + target.radius || distance < .001) return false; const direction = source.direction ?? { x: 1, y: 0 }, halfAngle = (spell.coneAngle ?? Math.PI / 2) / 2; return (delta.x * direction.x + delta.y * direction.y) / distance >= Math.cos(halfAngle); }
  if (spell.delivery === 'beam') { const direction = source.direction ?? { x: 1, y: 0 }, along = alongRay(source.position, direction, target.position); if (along < 0 || along > spell.range + target.radius) return false; const end = { x: source.position.x + direction.x * spell.range, y: source.position.y + direction.y * spell.range }; return pointSegmentDistance(target.position, source.position, end) <= (spell.beam?.width ?? spell.radius) + target.radius; }
  if (spell.delivery === 'area' || spell.delivery === 'summon' && source.kind === 'field') return Math.hypot(target.position.x - source.position.x, target.position.y - source.position.y) <= source.radius + target.radius;
  return false;
}

function targets(state: GameState, source: EntityState, now: number): CollisionTarget[] { return [...Object.values(state.players).map((p) => ({ id: p.id, position: p.position, radius: 24, combatant: p, kind: 'player' as const })), ...Object.values(state.entities).filter((e) => e.id !== source.id && (e.kind === 'monster' || e.kind === 'wall')).map((e) => ({ id: e.id, position: positionAt(e, now), radius: e.radius, combatant: e, kind: e.kind }))]; }

function blocks(source: EntityState, target: CollisionTarget) { const spec = source.source!.spell.blocking; if (target.kind === 'wall') return spec.blockByWalls; if (target.kind !== 'player') return spec.blockBySummons || spec.blockByNeutral; if (target.id === source.ownerId) return spec.blockBySelf; const ownerFaction = source.faction, targetFaction = target.combatant.faction, allied = ownerFaction.id === targetFaction.id || ownerFaction.team === targetFaction.team; return allied ? spec.blockByAllies : spec.blockByEnemies; }

export function collisionCandidates(state: GameState, source: EntityState, now: number, previous?: Vec2): CollisionCandidate[] {
  const spell = source.source?.spell, owner = source.ownerId ? state.players[source.ownerId] ?? state.entities[source.ownerId] : undefined; if (!spell || !owner) return [];
  const candidates = targets(state, source, now).flatMap((target) => { if (target.id === source.ownerId && !spell.targeting.canHitSelf || !intersectsSource(source, target, now, previous)) return []; const hittable = canTarget(source.ownerId ?? source.id, target.id, owner, target.combatant, spell.targeting); if (!hittable && !blocks(source, target)) return []; return [{ target, reason: hittable ? 'hit' as const : 'blocked' as const }]; }).sort((a, b) => Math.hypot(a.target.position.x - source.position.x, a.target.position.y - source.position.y) - Math.hypot(b.target.position.x - source.position.x, b.target.position.y - source.position.y));
  return spell.delivery === 'beam' && spell.beam?.mode === 'normal' ? candidates.slice(0, 1) : candidates;
}
