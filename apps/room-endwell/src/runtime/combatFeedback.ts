import type { GameEvent } from '../game/contracts';

export function consumeLargeImpact(event: Extract<GameEvent, { type: 'damage_applied' }>, consumed: Set<string>) {
  if (event.amount <= 0 || !event.largeImpact || consumed.has(event.sourceId)) return false;
  consumed.add(event.sourceId);
  return true;
}

export function isMonsterDeath(event: Extract<GameEvent, { type: 'entity_destroyed' }>) {
  return event.kind === 'monster' && event.reason === 'killed';
}
