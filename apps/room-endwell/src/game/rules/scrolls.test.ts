import { describe, expect, it } from 'vitest';
import { createScroll, isScroll, ownedReadyScrollFor, resolveScrollSpell, SCROLLS } from './scrolls';
import { player } from './state';

describe('scroll catalog', () => {
  it('creates serializable scroll items for every catalog entry', () => {
    expect(SCROLLS).toHaveLength(4);
    for (const definition of SCROLLS) {
      const scroll = createScroll(definition.id, 'test');
      expect(isScroll(scroll)).toBe(true);
      expect(scroll.elements).toEqual(definition.elements);
      expect(() => JSON.stringify(scroll)).not.toThrow();
    }
  });

  it('requires ownership and cooldown readiness for scroll resolution', () => {
    const p = player('p1', 'one', 0), scroll = createScroll('supernova', 'test');
    expect(resolveScrollSpell(scroll.elements, p, 1000)).toBeNull();
    p.inventory.push(scroll);
    expect(ownedReadyScrollFor(scroll.elements, p, 1000)?.definition.id).toBe('supernova');
    expect(resolveScrollSpell(scroll.elements, p, 1000)?.id).toBe('supernova');
    p.scrollCooldowns.supernova = 25_000;
    expect(resolveScrollSpell(scroll.elements, p, 1000)).toBeNull();
    expect(resolveScrollSpell(scroll.elements, p, 25_000)?.id).toBe('supernova');
  });
});
