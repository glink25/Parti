import { describe, expect, it } from 'vitest';
import { computeHudLayout, hudBlocksWorld } from './hud';

describe('mobile HUD layout', () => {
  it('fits seven non-overlapping touch buttons on a narrow screen', () => { const layout = computeHudLayout(390, 844); expect(layout.elementCenters).toHaveLength(7); for (let i = 1; i < layout.elementCenters.length; i++) expect(layout.elementCenters[i]!.x - layout.elementCenters[i - 1]!.x).toBeGreaterThanOrEqual(layout.elementCenters[i]!.r + layout.elementCenters[i - 1]!.r); expect(layout.elementPanel.x).toBeGreaterThanOrEqual(0); expect(layout.elementPanel.x + layout.elementPanel.w).toBeLessThanOrEqual(390); });
  it('blocks world input inside the element panel', () => { const layout = computeHudLayout(390, 844), point = layout.elementCenters[3]!; expect(hudBlocksWorld(layout, point)).toBe(true); expect(hudBlocksWorld(layout, { x: 195, y: 300 })).toBe(false); });
  it('blocks inventory button and the panel only when open', () => { const layout = computeHudLayout(844, 390), button = { x: layout.inventoryButton.x + 1, y: layout.inventoryButton.y + 1 }, panel = { x: layout.inventoryPanel.x + layout.inventoryPanel.w / 2, y: layout.inventoryPanel.y + layout.inventoryPanel.h / 2 }; expect(hudBlocksWorld(layout, button)).toBe(true); expect(hudBlocksWorld(layout, panel)).toBe(false); expect(hudBlocksWorld(layout, panel, true)).toBe(true); });
});
