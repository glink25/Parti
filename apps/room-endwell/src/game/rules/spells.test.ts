import { describe, expect, it } from 'vitest';
import { ELEMENTS } from '../../content/spells';
import type { Element } from '../contracts';
import { applySpellModifiers } from './modifiers';
import { resolveSpell, spellTargetMode } from './spells';

function sequences(length: number, prefix: Element[] = []): Element[][] { if (!length) return [prefix]; return ELEMENTS.flatMap((element) => sequences(length - 1, [...prefix, element])); }
describe('generated spell resolver', () => {
  it('resolves every one-to-four element sequence to a serializable valid spec', () => { const all = [1, 2, 3, 4].flatMap((length) => sequences(length)); expect(all).toHaveLength(2800); for (const elements of all) { const spell = resolveSpell(elements); expect(spell.elements).toEqual(elements); expect(spell.id).toBeTruthy(); expect(spell.name).toBeTruthy(); expect(Number.isFinite(spell.chantMs)).toBe(true); expect(Number.isFinite(spell.range)).toBe(true); expect(() => JSON.stringify(spell)).not.toThrow(); } });
  it('prioritizes exact recipes and covers every delivery', () => { expect(resolveSpell(['fire', 'rock', 'rock', 'fire'])).toMatchObject({ id: 'meteor', delivery: 'area' }); expect(resolveSpell(['fire', 'water', 'water', 'fire'])).toMatchObject({ id: 'rain', delivery: 'environment' }); expect(resolveSpell(['lightning', 'shield', 'lightning'])).toMatchObject({ id: 'teleport', delivery: 'instant' }); expect(resolveSpell(['fire']).delivery).toBe('spray'); expect(resolveSpell(['life'])).toMatchObject({ delivery: 'instant', instant: { kind: 'selfHeal' } }); expect(resolveSpell(['water', 'rock']).delivery).toBe('projectile'); expect(resolveSpell(['fire', 'shield']).delivery).toBe('shield'); expect(resolveSpell(['fire', 'rock', 'shield'])).toMatchObject({ delivery: 'summon', summon: { archetype: 'fire-field' } }); });
  it('maps Magicka special recipes to named Endwell specs', () => {
    const cases: Array<[Element[], string]> = [
      [['lightning', 'life', 'lightning'], 'resurrect'],
      [['lightning', 'shield', 'lightning'], 'teleport'],
      [['life', 'ice', 'shield'], 'cleanse'],
      [['lightning', 'shield', 'fire'], 'haste'],
      [['water', 'life'], 'life-spring'],
      [['life', 'lightning', 'life'], 'chain-heal'],
      [['shield', 'rock'], 'rock-shield'],
      [['shield', 'fire'], 'fire-shield'],
      [['shield', 'ice'], 'frost-shield'],
      [['shield', 'lightning'], 'grounding-shield'],
      [['shield', 'water'], 'water-shield'],
      [['fire', 'life'], 'life-flame'],
      [['water', 'ice'], 'frost-stream'],
      [['fire', 'rock', 'rock', 'fire'], 'meteor'],
      [['rock', 'fire'], 'lava-bolt'],
      [['rock', 'ice'], 'shatter-ice-bolt'],
      [['water', 'lightning'], 'conductive-water-chain'],
      [['fire', 'fire'], 'flame-jet'],
      [['ice', 'ice', 'rock'], 'ice-lance'],
      [['water', 'rock', 'water'], 'tidal-impact'],
      [['lightning', 'fire', 'fire', 'lightning'], 'lightning-strike'],
      [['water', 'ice', 'ice', 'water'], 'blizzard'],
      [['fire', 'water', 'water', 'fire'], 'rain'],
      [['fire', 'water'], 'steam-cloud'],
      [['ice', 'shield', 'shield', 'ice'], 'magicka-ice-wall'],
      [['lightning', 'water', 'lightning', 'shield'], 'thunderstorm'],
      [['rock', 'shield', 'lightning', 'rock'], 'gravity-well'],
      [['fire', 'shield', 'fire'], 'fire-ring'],
      [['life', 'shield', 'life', 'shield'], 'life-barrier'],
    ];
    for (const [elements, id] of cases) expect(resolveSpell(elements)).toMatchObject({ id, elements });
  });
  it('covers all seven single elements without fallback', () => { expect(ELEMENTS.map((element) => resolveSpell([element]).delivery)).toEqual(['projectile', 'spray', 'spray', 'instant', 'spray', 'spray', 'shield']); });
  it('classifies self, direction, and point targeting consistently', () => { expect(spellTargetMode(resolveSpell(['life']))).toBe('self'); expect(spellTargetMode(resolveSpell(['shield']))).toBe('self'); expect(spellTargetMode(resolveSpell(['fire', 'shield', 'fire']))).toBe('self'); expect(spellTargetMode(resolveSpell(['fire']))).toBe('direction'); expect(spellTargetMode(resolveSpell(['rock']))).toBe('direction'); expect(spellTargetMode(resolveSpell(['fire', 'rock', 'rock', 'fire']))).toBe('point'); expect(spellTargetMode(resolveSpell(['lightning', 'shield', 'lightning']))).toBe('point'); });
  it('marks only configured large-impact recipes', () => { for (const elements of [[['fire', 'rock', 'rock', 'fire']], [['lightning', 'fire', 'fire', 'lightning']], [['rock', 'shield', 'lightning', 'rock']]] as Element[][][]) expect(resolveSpell(elements[0]!).tags).toContain('large-impact'); expect(resolveSpell(['fire']).tags).not.toContain('large-impact'); expect(resolveSpell(['water', 'lightning']).tags).not.toContain('large-impact'); });
  it('separates projectile, hostile area, and healing-field targeting', () => { expect(resolveSpell(['rock']).targeting).toMatchObject({ canHitSelf: false, canHitAllies: true }); expect(resolveSpell(['fire', 'rock', 'rock', 'fire']).targeting).toMatchObject({ canHitSelf: true, canHitAllies: true }); expect(resolveSpell(['fire', 'rock', 'shield']).targeting).toMatchObject({ canHitSelf: true, canHitAllies: true }); expect(resolveSpell(['life', 'rock', 'shield']).targeting).toMatchObject({ canHitSelf: true, canHitAllies: true, canHitEnemies: false }); expect(resolveSpell(['water', 'life']).targeting).toMatchObject({ canHitSelf: true, canHitAllies: true, canHitEnemies: false }); });
  it('applies modifiers without mutating generated specs', () => { const base = resolveSpell(['fire', 'rock']), changed = applySpellModifiers(base, [{ stat: 'speed', op: 'multiply', value: 1.5 }]); expect(changed.speed).toBe((base.speed ?? 0) * 1.5); expect(base.speed).toBe(460); });
});
