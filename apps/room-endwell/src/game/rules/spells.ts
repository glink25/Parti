import { beamSpec, meteorSpec, projectileSpec, rainSpec, shieldSpec, spraySpec, summonSpec } from '../../content/spells';
import type { Element, SpellSpec } from '../contracts';

const exact = (elements: readonly Element[], sequence: readonly Element[]) => elements.length === sequence.length && sequence.every((element, index) => elements[index] === element);
export function resolveSpell(elements: Element[]): SpellSpec {
  if (!elements.length || elements.length > 4) throw new Error('Element sequence must contain 1-4 elements');
  if (exact(elements, ['fire', 'rock', 'rock', 'fire'])) return meteorSpec(elements);
  if (exact(elements, ['fire', 'water', 'water', 'fire'])) return rainSpec(elements);
  const last = elements.at(-1)!;
  if (last === 'shield') return elements.slice(0, -1).includes('rock') ? summonSpec(elements) : shieldSpec(elements);
  if (last === 'life') return beamSpec(elements);
  if (last === 'rock') return projectileSpec(elements);
  return spraySpec(elements);
}
