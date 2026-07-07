import { describe, expect, it } from 'vitest';
import type { SummonArchetype } from '../contracts';
import { spawnMeteorImpact, spawnMeteorWarning, spawnSpellEntity } from './entities';
import { initialState, player } from './state';
import { resolveSpell } from './spells';

function summon(elements: Parameters<typeof resolveSpell>[0]) { const state = initialState(), caster = player('p1', 'one', 0), spell = resolveSpell(elements); caster.cast = { phase: 'active', castId: 'p1:cast:1', spell, startedAt: 0, phaseEndsAt: null, aim: { x: 1, y: 0 }, target: { x: 500, y: 300 } }; return spawnSpellEntity(state, caster, spell, 1000); }
describe('spell entities', () => {
  it('builds all summon archetypes with stable placement', () => { const cases: Array<[Parameters<typeof resolveSpell>[0], SummonArchetype]> = [[['rock', 'rock', 'shield'], 'rock-wall'], [['ice', 'rock', 'shield'], 'ice-wall'], [['fire', 'rock', 'shield'], 'fire-field'], [['lightning', 'rock', 'shield'], 'lightning-field'], [['water', 'rock', 'shield'], 'water-pool'], [['life', 'rock', 'shield'], 'healing-field']]; for (const [elements, archetype] of cases) expect(summon(elements)).toMatchObject({ id: 'p1:cast:1:summon:0', archetype, position: { x: 500, y: 300 } }); });
  it('supports self-positioned special fields', () => { expect(summon(['fire', 'shield', 'fire'])).toMatchObject({ archetype: 'fire-ring', position: { x: 0, y: 0 } }); });
  it('gives walls obstacles and fields periodic sources', () => { expect(summon(['ice', 'rock', 'shield']).obstacle).toMatchObject({ material: 'ice', blocksProjectile: true, blocksBeam: true }); expect(summon(['fire', 'rock', 'shield']).source?.tickMs).toBeGreaterThan(0); });
  it('separates meteor warning from damaging impact', () => { const state = initialState(), caster = player('p1', 'one', 0), spell = resolveSpell(['fire', 'rock', 'rock', 'fire']); caster.cast = { phase: 'warning', castId: 'p1:cast:1', spell, startedAt: 0, phaseEndsAt: null, aim: { x: 1, y: 0 }, target: { x: 600, y: 300 } }; const warning = spawnMeteorWarning(state, caster, spell, 1000), impact = spawnMeteorImpact(state, caster, spell, 1700); expect(warning.source).toBeUndefined(); expect(warning.damageable.canReceiveDamage).toBe(false); expect(impact.source?.spell.id).toBe('meteor'); expect(impact.position).toEqual(warning.position); });
});
