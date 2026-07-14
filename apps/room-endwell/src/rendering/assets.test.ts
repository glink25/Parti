import { describe, expect, it } from 'vitest';
import { atlasSource, TILE_SPRITES } from './assets';
import { colorWithAlpha } from './visuals';

describe('Endwell visual asset mapping', () => {
  it('maps authored sprites to a four-by-four atlas', () => {
    const image = { naturalWidth: 1200, naturalHeight: 1200 } as HTMLImageElement;
    expect(atlasSource(image, 0)).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    expect(atlasSource(image, 5)).toEqual({ x: 300, y: 300, w: 300, h: 300 });
    expect(atlasSource(image, 15)).toEqual({ x: 900, y: 900, w: 300, h: 300 });
  });

  it('provides distinct gameplay silhouettes', () => {
    expect(new Set([TILE_SPRITES.player.cell, TILE_SPRITES.chaser.cell, TILE_SPRITES.shooter.cell, TILE_SPRITES.guardian.cell]).size).toBe(4);
    expect(TILE_SPRITES.boss.drawWidth).toBeGreaterThan(TILE_SPRITES.guardian.drawWidth);
  });

  it('normalizes shorthand colors before adding alpha', () => {
    expect(colorWithAlpha('#eee', .36)).toBe('#eeeeee5c');
    expect(colorWithAlpha('#65f3dc', 0)).toBe('#65f3dc00');
  });
});
