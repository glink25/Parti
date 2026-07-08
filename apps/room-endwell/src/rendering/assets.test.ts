import { describe, expect, it } from 'vitest';
import { TILE_SPRITES, tileSource } from './assets';
import { colorWithAlpha } from './visuals';

describe('Endwell visual asset mapping', () => {
  it('maps packed dungeon tile ids to 16px source cells', () => {
    expect(tileSource(0)).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    expect(tileSource(13)).toEqual({ x: 16, y: 16, w: 16, h: 16 });
    expect(tileSource(131)).toEqual({ x: 176, y: 160, w: 16, h: 16 });
  });

  it('provides distinct gameplay silhouettes', () => {
    expect(new Set([TILE_SPRITES.player.tile, TILE_SPRITES.chaser.tile, TILE_SPRITES.shooter.tile, TILE_SPRITES.guardian.tile]).size).toBe(4);
    expect(TILE_SPRITES.boss.drawWidth).toBeGreaterThan(TILE_SPRITES.guardian.drawWidth);
  });

  it('normalizes shorthand colors before adding alpha', () => {
    expect(colorWithAlpha('#eee', .36)).toBe('#eeeeee5c');
    expect(colorWithAlpha('#65f3dc', 0)).toBe('#65f3dc00');
  });
});
