import type { Combatant, EntityState, GameState, Vec2 } from '../contracts';
import { isWalkable } from '../roguelike';
import { canTarget } from './combat';
import { positionAt } from './entities';

export type CollisionTarget = { id: string; position: Vec2; radius: number; combatant: Combatant; kind: 'player' | EntityState['kind'] };
export type CollisionCandidate = { target: CollisionTarget; reason: 'hit' | 'blocked' };
export type BeamSegment = { from: Vec2; to: Vec2 };

const EPSILON = 1.5;
const add = (a: Vec2, b: Vec2, scale = 1): Vec2 => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
const normalize = (value: Vec2): Vec2 => { const length = Math.hypot(value.x, value.y) || 1; return { x: value.x / length, y: value.y / length }; };
const reflect = (direction: Vec2, normal: Vec2): Vec2 => normalize({ x: direction.x - 2 * (direction.x * normal.x + direction.y * normal.y) * normal.x, y: direction.y - 2 * (direction.x * normal.x + direction.y * normal.y) * normal.y });
function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) { const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy; if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y); const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)); return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t)); }

function targets(state: GameState, source: EntityState, now: number): CollisionTarget[] { return [...Object.values(state.players).filter((p) => p.alive).map((p) => ({ id: p.id, position: p.position, radius: 24, combatant: p, kind: 'player' as const })), ...Object.values(state.entities).filter((e) => e.id !== source.id && (e.kind === 'monster' || e.kind === 'wall')).map((e) => ({ id: e.id, position: positionAt(e, now), radius: e.radius, combatant: e, kind: e.kind }))]; }
function blocks(source: EntityState, target: CollisionTarget) { const spec = source.source!.spell.blocking; if (target.kind === 'wall') return spec.blockByWalls; if (target.kind !== 'player') return spec.blockBySummons || spec.blockByNeutral; if (target.id === source.ownerId) return spec.blockBySelf; const ownerFaction = source.faction, targetFaction = target.combatant.faction, allied = ownerFaction.id === targetFaction.id || ownerFaction.team === targetFaction.team; return allied ? spec.blockByAllies : spec.blockByEnemies; }
function rayCircle(origin: Vec2, direction: Vec2, center: Vec2, radius: number, max: number) { const delta = { x: center.x - origin.x, y: center.y - origin.y }, along = delta.x * direction.x + delta.y * direction.y, perpendicular2 = delta.x * delta.x + delta.y * delta.y - along * along, radius2 = radius * radius; if (perpendicular2 > radius2) return null; const distance = along - Math.sqrt(Math.max(0, radius2 - perpendicular2)); return distance >= EPSILON && distance <= max ? distance : null; }
function worldHit(state: GameState, origin: Vec2, direction: Vec2, max: number, width: number) { const stage = state.run.stage; if (!stage) return null; const step = Math.max(3, Math.min(8, width * .5)); let previous = 0; for (let distance = step; distance <= max + step; distance += step) { const at = Math.min(max, distance), point = add(origin, direction, at); if (!isWalkable(stage, point, width)) { let low = previous, high = at; for (let i = 0; i < 7; i++) { const middle = (low + high) / 2; if (isWalkable(stage, add(origin, direction, middle), width)) low = middle; else high = middle; } const hit = add(origin, direction, low), probe = Math.max(5, width), walkX = isWalkable(stage, { x: hit.x - Math.sign(direction.x || 1) * probe, y: hit.y }, width), walkY = isWalkable(stage, { x: hit.x, y: hit.y - Math.sign(direction.y || 1) * probe }, width); let normal: Vec2; if (walkX && !walkY) normal = { x: -Math.sign(direction.x || 1), y: 0 }; else if (walkY && !walkX) normal = { x: 0, y: -Math.sign(direction.y || 1) }; else normal = Math.abs(direction.x) > Math.abs(direction.y) ? { x: -Math.sign(direction.x), y: 0 } : { x: 0, y: -Math.sign(direction.y) }; return { distance: low, point: hit, normal }; } previous = at; if (at === max) break; } return null; }

export function beamSegments(state: GameState, source: EntityState, now: number): BeamSegment[] {
  const spell = source.source?.spell; if (!spell || spell.delivery !== 'beam') return [];
  const mode = spell.beam?.mode ?? 'normal', maxBounces = mode === 'reflect' ? spell.beam?.maxBounces ?? 1 : 0, width = spell.beam?.width ?? spell.radius;
  let origin = { ...source.position }, direction = normalize(source.direction ?? { x: 1, y: 0 }), remaining = spell.range, ignoredId: string | null = null; const result: BeamSegment[] = [];
  for (let bounce = 0; remaining > EPSILON && bounce <= maxBounces; bounce++) {
    const staticHit = mode === 'pierce' ? null : worldHit(state, origin, direction, remaining, width), entities = mode === 'pierce' ? [] : targets(state, source, now).filter((target) => target.id !== ignoredId && blocks(source, target)).map((target) => ({ target, distance: rayCircle(origin, direction, target.position, target.radius + width, remaining) })).filter((entry): entry is { target: CollisionTarget; distance: number } => entry.distance != null).sort((a, b) => a.distance - b.distance), entityHit = entities[0], hitDistance = Math.min(staticHit?.distance ?? remaining, entityHit?.distance ?? remaining), end = add(origin, direction, hitDistance); result.push({ from: { ...origin }, to: end });
    if (mode !== 'reflect' || bounce === maxBounces || hitDistance >= remaining - EPSILON) break;
    const normal = entityHit && entityHit.distance <= (staticHit?.distance ?? Infinity) ? normalize({ x: end.x - entityHit.target.position.x, y: end.y - entityHit.target.position.y }) : staticHit!.normal; ignoredId = entityHit && entityHit.distance <= (staticHit?.distance ?? Infinity) ? entityHit.target.id : null; remaining -= hitDistance; direction = reflect(direction, normal); origin = add(end, direction, EPSILON);
  }
  return result;
}

export function intersectsSource(source: EntityState, target: { position: Vec2; radius: number }, now: number, previous?: Vec2, state?: GameState): boolean {
  const spell = source.source?.spell; if (!spell) return false; const position = positionAt(source, now);
  if (spell.delivery === 'projectile') return pointSegmentDistance(target.position, previous ?? position, position) <= source.radius + target.radius;
  if (spell.delivery === 'spray') { const origin = source.position, delta = { x: target.position.x - origin.x, y: target.position.y - origin.y }, distance = Math.hypot(delta.x, delta.y); if (distance > spell.range + target.radius || distance < .001) return false; const direction = source.direction ?? { x: 1, y: 0 }, halfAngle = (spell.coneAngle ?? Math.PI / 3) / 2; return (delta.x * direction.x + delta.y * direction.y) / distance >= Math.cos(halfAngle); }
  if (spell.delivery === 'beam') { const segments = state ? beamSegments(state, source, now) : [{ from: source.position, to: add(source.position, source.direction ?? { x: 1, y: 0 }, spell.range) }]; return segments.some((segment) => pointSegmentDistance(target.position, segment.from, segment.to) <= (spell.beam?.width ?? spell.radius) + target.radius); }
  if (spell.delivery === 'area' || spell.delivery === 'summon' && source.kind === 'field') return Math.hypot(target.position.x - source.position.x, target.position.y - source.position.y) <= source.radius + target.radius;
  return false;
}

export function collisionCandidates(state: GameState, source: EntityState, now: number, previous?: Vec2): CollisionCandidate[] {
  const spell = source.source?.spell, owner = source.ownerId ? state.players[source.ownerId] ?? state.entities[source.ownerId] : undefined; if (!spell || !owner || 'alive' in owner && !owner.alive) return [];
  const candidates = targets(state, source, now).flatMap((target) => { if (target.id === source.ownerId && !spell.targeting.canHitSelf || !intersectsSource(source, target, now, previous, state)) return []; const hittable = canTarget(source.ownerId ?? source.id, target.id, owner, target.combatant, spell.targeting); if (!hittable && !blocks(source, target)) return []; return [{ target, reason: hittable ? 'hit' as const : 'blocked' as const }]; });
  if (spell.delivery === 'beam') { const segments = beamSegments(state, source, now), order = (target: CollisionTarget) => { let total = 0; for (const segment of segments) { if (pointSegmentDistance(target.position, segment.from, segment.to) <= target.radius + (spell.beam?.width ?? spell.radius)) return total + Math.hypot(target.position.x - segment.from.x, target.position.y - segment.from.y); total += Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y); } return Infinity; }; return candidates.sort((a, b) => order(a.target) - order(b.target)); }
  candidates.sort((a, b) => Math.hypot(a.target.position.x - source.position.x, a.target.position.y - source.position.y) - Math.hypot(b.target.position.x - source.position.x, b.target.position.y - source.position.y));
  return spell.delivery === 'projectile' && !spell.tags.includes('pierce') ? candidates.slice(0, 1) : candidates;
}

export function verifiesHit(state: GameState, source: EntityState, targetId: string, reason: 'hit' | 'blocked', now: number) { return collisionCandidates(state, source, now, source.position).some((candidate) => candidate.target.id === targetId && candidate.reason === reason); }
