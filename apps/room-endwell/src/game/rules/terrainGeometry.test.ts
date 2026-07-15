import { describe, expect, it } from 'vitest';
import type { TerrainState } from '../contracts';
import { terrainBounds, terrainOverlaps } from './terrainGeometry';

const terrain = (values: Partial<TerrainState>): TerrainState => ({ id: 'terrain', roomId: 'room', kind: 'obstacle', position: { x: 100, y: 100 }, radius: 60, blocksMovement: true, active: true, warningAt: null, activatesAt: null, endsAt: null, ...values });

describe('terrain geometry', () => {
  it('uses the visible circular obstacle radius as its collision radius', () => { const obstacle = terrain({}); expect(terrainBounds(obstacle)).toEqual({ shape: 'circle', radius: 60 }); expect(terrainOverlaps(obstacle, { x: 159, y: 100 }, 0)).toBe(true); expect(terrainOverlaps(obstacle, { x: 161, y: 100 }, 0)).toBe(false); });
  it('uses the visible rune-wall rectangle as its collision bounds', () => { const wall = terrain({ kind: 'rune-wall', width: 42, height: 220 }); expect(terrainBounds(wall)).toEqual({ shape: 'rect', width: 42, height: 220 }); expect(terrainOverlaps(wall, { x: 120, y: 209 }, 0)).toBe(true); expect(terrainOverlaps(wall, { x: 122, y: 100 }, 0)).toBe(false); });
  it('gives falling rocks the same circular texture and collision footprint', () => { expect(terrainBounds(terrain({ kind: 'falling-rock', radius: 95 }))).toEqual({ shape: 'circle', radius: 95 }); });
});
