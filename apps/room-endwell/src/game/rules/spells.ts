import { beamSpec, blizzardSpec, chainHealSpec, cleanseSpec, conductiveWaterSpec, fireRingSpec, fireShieldSpec, flameJetSpec, frostShieldSpec, frostStreamSpec, gravityWellSpec, groundingShieldSpec, hasteSpec, iceLanceSpec, lavaBoltSpec, lifeBarrierSpec, lifeFlameSpec, lifeSpringSpec, magickaIceWallSpec, meteorSpec, projectileSpec, rainSpec, resurrectSpec, rockShieldSpec, shieldSpec, shatterIceBoltSpec, spraySpec, steamCloudSpec, summonSpec, teleportSpec, thunderstormSpec, tidalImpactSpec, waterShieldSpec, lightningStrikeSpec } from '../../content/spells';
import type { Element, SpellSpec } from '../contracts';

const exact = (elements: readonly Element[], sequence: readonly Element[]) => elements.length === sequence.length && sequence.every((element, index) => elements[index] === element);
const recipes: Array<{ sequence: Element[]; spec: (elements: Element[]) => SpellSpec }> = [
  { sequence: ['lightning', 'life', 'lightning'], spec: resurrectSpec },
  { sequence: ['lightning', 'shield', 'lightning'], spec: teleportSpec },
  { sequence: ['life', 'ice', 'shield'], spec: cleanseSpec },
  { sequence: ['lightning', 'shield', 'fire'], spec: hasteSpec },
  { sequence: ['water', 'life'], spec: lifeSpringSpec },
  { sequence: ['life', 'lightning', 'life'], spec: chainHealSpec },
  { sequence: ['shield', 'rock'], spec: rockShieldSpec },
  { sequence: ['shield', 'fire'], spec: fireShieldSpec },
  { sequence: ['shield', 'ice'], spec: frostShieldSpec },
  { sequence: ['shield', 'lightning'], spec: groundingShieldSpec },
  { sequence: ['shield', 'water'], spec: waterShieldSpec },
  { sequence: ['fire', 'life'], spec: lifeFlameSpec },
  { sequence: ['water', 'ice'], spec: frostStreamSpec },
  { sequence: ['fire', 'rock', 'rock', 'fire'], spec: meteorSpec },
  { sequence: ['rock', 'fire'], spec: lavaBoltSpec },
  { sequence: ['rock', 'ice'], spec: shatterIceBoltSpec },
  { sequence: ['water', 'lightning'], spec: conductiveWaterSpec },
  { sequence: ['fire', 'fire'], spec: flameJetSpec },
  { sequence: ['ice', 'ice', 'rock'], spec: iceLanceSpec },
  { sequence: ['water', 'rock', 'water'], spec: tidalImpactSpec },
  { sequence: ['lightning', 'fire', 'fire', 'lightning'], spec: lightningStrikeSpec },
  { sequence: ['water', 'ice', 'ice', 'water'], spec: blizzardSpec },
  { sequence: ['fire', 'water', 'water', 'fire'], spec: rainSpec },
  { sequence: ['fire', 'water'], spec: steamCloudSpec },
  { sequence: ['ice', 'shield', 'shield', 'ice'], spec: magickaIceWallSpec },
  { sequence: ['lightning', 'water', 'lightning', 'shield'], spec: thunderstormSpec },
  { sequence: ['rock', 'shield', 'lightning', 'rock'], spec: gravityWellSpec },
  { sequence: ['fire', 'shield', 'fire'], spec: fireRingSpec },
  { sequence: ['life', 'shield', 'life', 'shield'], spec: lifeBarrierSpec },
];
export function resolveSpell(elements: Element[]): SpellSpec {
  if (!elements.length || elements.length > 4) throw new Error('Element sequence must contain 1-4 elements');
  for (const recipe of recipes) if (exact(elements, recipe.sequence)) return recipe.spec(elements);
  const last = elements.at(-1)!;
  if (last === 'shield') return elements.slice(0, -1).includes('rock') ? summonSpec(elements) : shieldSpec(elements);
  if (last === 'life') return beamSpec(elements);
  if (last === 'rock') return projectileSpec(elements);
  return spraySpec(elements);
}
