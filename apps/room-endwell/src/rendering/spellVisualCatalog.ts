import type { Element, SpellSpec, Vec2 } from '../game/contracts';
import { primaryVisualElement } from './spellVisualGeometry';

export type SpellVisualKind = 'spray' | 'beam' | 'projectile' | 'field' | 'meteor' | 'rain' | 'blizzard' | 'shield' | 'instant';
export type SpellVisual = { kind: SpellVisualKind; cell?: number; intrinsicHeading?: number; scale?: number };

export const ELEMENT_VFX_CELLS: Record<Element, number> = { rock: 0, fire: 1, ice: 2, life: 3, lightning: 4, water: 5, shield: 6 };
export const DIRECTIONAL_VFX_HEADINGS: Partial<Record<Element, number>> = { rock: Math.PI * 3 / 4, fire: Math.PI * 3 / 4, ice: Math.PI * 3 / 4 };

export function directionAngle(direction: Vec2, intrinsicHeading = 0) { return Math.atan2(direction.y, direction.x) - intrinsicHeading; }

export function spellVisual(spell: SpellSpec): SpellVisual {
  if (spell.visualKey === 'area.meteor') return { kind: 'meteor', cell: ELEMENT_VFX_CELLS.fire, intrinsicHeading: DIRECTIONAL_VFX_HEADINGS.fire, scale: 1.15 };
  if (spell.visualKey === 'environment.rain') return { kind: 'rain' };
  if (spell.visualKey === 'environment.blizzard') return { kind: 'blizzard' };
  if (spell.delivery === 'spray') return { kind: 'spray' };
  if (spell.delivery === 'beam') return { kind: 'beam' };
  if (spell.delivery === 'projectile') { const element = primaryVisualElement(spell.elements); return { kind: 'projectile', cell: ELEMENT_VFX_CELLS[element], intrinsicHeading: DIRECTIONAL_VFX_HEADINGS[element] ?? 0, scale: element === 'ice' ? 1.08 : 1 }; }
  if (spell.delivery === 'summon' || spell.delivery === 'area') return { kind: 'field' };
  if (spell.delivery === 'shield') return { kind: 'shield' };
  if (spell.delivery === 'instant') return { kind: 'instant' };
  throw new Error(`Unsupported spell visual: ${spell.visualKey}`);
}
