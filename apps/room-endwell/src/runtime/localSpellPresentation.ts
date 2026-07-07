import type { EntityState, GameState, Vec2 } from '../game/contracts';

export type LocalSpellPresentation = { sourceId: string; position: Vec2; direction: Vec2; targetDirection: Vec2 };

function turnToward(current: Vec2, target: Vec2, maxRadians: number): Vec2 {
  const from = Math.atan2(current.y, current.x), to = Math.atan2(target.y, target.x), delta = Math.atan2(Math.sin(to - from), Math.cos(to - from)), angle = from + Math.max(-maxRadians, Math.min(maxRadians, delta));
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function updateLocalSpellPresentations(presentations: Map<string, LocalSpellPresentation>, state: GameState, ownerId: string, position: Vec2, aim: Vec2, dt: number) {
  const active = new Set<string>();
  for (const entity of Object.values(state.entities)) {
    if (entity.ownerId !== ownerId || entity.detached || !entity.source || entity.source.spell.delivery !== 'beam' && entity.source.spell.delivery !== 'spray') continue;
    active.add(entity.id);
    const previous = presentations.get(entity.id), currentDirection = previous?.direction ?? entity.direction ?? aim, direction = entity.source.spell.delivery === 'beam' ? turnToward(currentDirection, aim, (entity.source.spell.beam?.turnSpeed ?? Math.PI * 1.5) * dt) : { ...aim };
    presentations.set(entity.id, { sourceId: entity.id, position: { ...position }, direction, targetDirection: { ...aim } });
  }
  for (const id of presentations.keys()) if (!active.has(id)) presentations.delete(id);
}

export function presentedSpellEntity(entity: EntityState, presentations: ReadonlyMap<string, LocalSpellPresentation>): EntityState {
  const presentation = presentations.get(entity.id);
  return presentation ? { ...entity, position: { ...presentation.position }, direction: { ...presentation.direction }, targetDirection: { ...presentation.targetDirection } } : entity;
}
