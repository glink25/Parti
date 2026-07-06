import { describe, expect, it } from 'vitest';
import { ELEMENTS } from '../../content/spells';
import type { Element } from '../contracts';
import { applySpellModifiers } from './modifiers';
import { resolveSpell } from './spells';

function sequences(length: number, prefix: Element[] = []): Element[][] { if (!length) return [prefix]; return ELEMENTS.flatMap((element) => sequences(length - 1, [...prefix, element])); }
describe('generated spell resolver', () => {
  it('resolves every one-to-four element sequence to a serializable valid spec', () => { const all = [1, 2, 3, 4].flatMap((length) => sequences(length)); expect(all).toHaveLength(2800); for (const elements of all) { const spell = resolveSpell(elements); expect(spell.elements).toEqual(elements); expect(spell.id).toBeTruthy(); expect(spell.name).toBeTruthy(); expect(Number.isFinite(spell.chantMs)).toBe(true); expect(Number.isFinite(spell.range)).toBe(true); expect(() => JSON.stringify(spell)).not.toThrow(); } });
  it('prioritizes exact recipes and covers every delivery', () => { expect(resolveSpell(['fire', 'rock', 'rock', 'fire'])).toMatchObject({ id: 'meteor', delivery: 'area' }); expect(resolveSpell(['fire', 'water', 'water', 'fire'])).toMatchObject({ id: 'rain', delivery: 'environment' }); expect(resolveSpell(['fire']).delivery).toBe('spray'); expect(resolveSpell(['life']).delivery).toBe('beam'); expect(resolveSpell(['water', 'rock']).delivery).toBe('projectile'); expect(resolveSpell(['fire', 'shield']).delivery).toBe('shield'); expect(resolveSpell(['fire', 'rock', 'shield'])).toMatchObject({ delivery: 'summon', summon: { archetype: 'fire-field' } }); });
  it('covers all seven single elements without fallback', () => { expect(ELEMENTS.map((element) => resolveSpell([element]).delivery)).toEqual(['projectile', 'spray', 'spray', 'beam', 'spray', 'spray', 'shield']); });
  it('applies modifiers without mutating generated specs', () => { const base = resolveSpell(['fire', 'rock']), changed = applySpellModifiers(base, [{ stat: 'speed', op: 'multiply', value: 1.5 }]); expect(changed.speed).toBe((base.speed ?? 0) * 1.5); expect(base.speed).toBe(460); });
});
