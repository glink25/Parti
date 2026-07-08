import { describe, expect, it } from 'vitest';
import { initialState, player } from '../game/rules/state';
import { resolveSpell } from '../game/rules/spells';
import { spawnSpellEntity } from '../game/rules/entities';
import { presentedSpellEntity, updateLocalSpellPresentations, type LocalSpellPresentation } from './localSpellPresentation';

describe('local spell presentation', () => {
  it('keeps beam presentation continuous across stale logical direction snapshots without mutating state', () => {
    const state = initialState(), caster = state.players.p1 = player('p1', 'one', 0), spell = resolveSpell(['fire', 'life']); caster.cast = { phase: 'active', castId: 'p1:cast:1', spell, startedAt: 0, phaseEndsAt: 5000, aim: { x: 1, y: 0 }, target: { x: 800, y: 300 } }; const entity = spawnSpellEntity(state, caster, spell, 0), original = structuredClone(entity), presentations = new Map<string, LocalSpellPresentation>();
    updateLocalSpellPresentations(presentations, state, caster.id, { x: 300, y: 330 }, { x: 0, y: 1 }, .1); const first = presentedSpellEntity(entity, presentations); expect(first.position).toEqual({ x: 300, y: 330 }); expect(first.direction!.y).toBeGreaterThan(0);
    entity.direction = { x: 1, y: 0 }; updateLocalSpellPresentations(presentations, state, caster.id, { x: 310, y: 340 }, { x: 0, y: 1 }, .1); const second = presentedSpellEntity(entity, presentations); expect(second.direction!.y).toBeGreaterThan(first.direction!.y); expect(entity.position).toEqual(original.position); expect(entity.direction).toEqual({ x: 1, y: 0 });
    delete state.entities[entity.id]; updateLocalSpellPresentations(presentations, state, caster.id, caster.position, caster.aim, .1); expect(presentations.size).toBe(0);
  });
});
