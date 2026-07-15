import { describe, expect, it } from 'vitest';
import { SCROLLS } from '../game/rules/scrolls';
import { resolveSpell, specialSpellCatalog } from '../game/rules/spells';
import { directionAngle, DIRECTIONAL_VFX_HEADINGS, spellVisual } from './spellVisualCatalog';
import { ELEMENTS } from '../content/spells';
import type { Element } from '../game/contracts';

function sequences(length: number, prefix: Element[] = []): Element[][] { return length === 0 ? [prefix] : ELEMENTS.flatMap((element) => sequences(length - 1, [...prefix, element])); }

describe('spell visual catalog', () => {
  it('covers generated, special, and scroll spells without an implicit unknown visual', () => {
    const spells = [
      ...[1, 2, 3, 4].flatMap((length) => sequences(length)).map(resolveSpell),
      ...specialSpellCatalog().map((entry) => entry.spell),
      ...SCROLLS.map((scroll) => scroll.spec([...scroll.elements])),
    ];
    for (const spell of spells) expect(() => spellVisual(spell)).not.toThrow();
    expect(spellVisual(resolveSpell(['fire', 'water', 'water', 'fire'])).kind).toBe('rain');
    expect(spellVisual(resolveSpell(['water', 'ice', 'ice', 'water'])).kind).toBe('blizzard');
  });

  it('aligns authored projectile headings with all four travel directions', () => {
    const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    for (const element of ['rock', 'fire', 'ice'] as const) for (const direction of directions) {
      const rotation = directionAngle(direction, DIRECTIONAL_VFX_HEADINGS[element]);
      expect(rotation + DIRECTIONAL_VFX_HEADINGS[element]!).toBeCloseTo(Math.atan2(direction.y, direction.x));
    }
    const meteor = spellVisual(resolveSpell(['fire', 'rock', 'rock', 'fire']));
    expect(meteor.intrinsicHeading).toBe(DIRECTIONAL_VFX_HEADINGS.fire);
  });
});
