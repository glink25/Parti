import { describe, expect, it } from 'vitest';
import { consumeLargeImpact, isMonsterDeath } from './combatFeedback';

describe('combat feedback shake policy', () => {
  it('consumes each large spell source once', () => { const consumed = new Set<string>(), event = { type: 'damage_applied', targetId: 'monster:1', amount: 20, element: 'fire', sourceId: 'cast:1', largeImpact: true } as const; expect(consumeLargeImpact(event, consumed)).toBe(true); expect(consumeLargeImpact({ ...event, targetId: 'monster:2' }, consumed)).toBe(false); expect(consumeLargeImpact({ ...event, sourceId: 'cast:2', largeImpact: false }, consumed)).toBe(false); });
  it('accepts only killed monsters', () => { expect(isMonsterDeath({ type: 'entity_destroyed', entityId: 'm', kind: 'monster', reason: 'killed' })).toBe(true); expect(isMonsterDeath({ type: 'entity_destroyed', entityId: 'm', kind: 'monster', reason: 'expired' })).toBe(false); expect(isMonsterDeath({ type: 'entity_destroyed', entityId: 'f', kind: 'field', reason: 'expired' })).toBe(false); });
});
