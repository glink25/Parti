import { describe, expect, it } from 'vitest';
import type { MapDefinition, Point } from './contracts';
import { MAPS, tileAt } from './maps';

const passable = (map: MapDefinition, point: Point) => !['steel', 'water'].includes(tileAt(map, point.x, point.y));
const spawnable = (map: MapDefinition, point: Point) => !['brick', 'steel', 'water'].includes(tileAt(map, point.x, point.y));

function reachesCenter(map: MapDefinition, start: Point): boolean {
  const key = (x: number, y: number) => `${x},${y}`; const goal = [Math.floor(map.center.x), Math.floor(map.center.y)];
  const queue: Array<[number, number]> = [[Math.floor(start.x), Math.floor(start.y)]]; const seen = new Set([key(...queue[0])]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [x, y] = queue[cursor]; if (Math.abs(x - goal[0]) + Math.abs(y - goal[1]) <= 2) return true;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const nx = x + dx; const ny = y + dy; const next = key(nx, ny);
      if (seen.has(next) || !passable(map, { x: nx + .5, y: ny + .5 })) continue;
      seen.add(next); queue.push([nx, ny]);
    }
  }
  return false;
}

describe('large tank battle maps', () => {
  it('provides ten distinct 26x20 layouts', () => {
    expect(MAPS).toHaveLength(10);
    expect(new Set(MAPS.map((map) => map.id)).size).toBe(10);
    for (const map of MAPS) { expect(map.width).toBe(26); expect(map.height).toBe(20); expect(map.tiles).toHaveLength(520); }
  });

  it('defines complete 2, 3 and 4 player FFA layouts', () => {
    for (const map of MAPS) for (const count of [2, 3, 4] as const) {
      const layout = map.ffaLayouts[count];
      expect(layout.spawns).toHaveLength(count); expect(layout.bases).toHaveLength(count);
      expect(layout.spawns.every((spawn) => spawnable(map, spawn) && reachesCenter(map, spawn))).toBe(true);
    }
  });

  it('provides protected team bases and valid activity points', () => {
    for (const map of MAPS) {
      expect(map.teamSpawns.red).toHaveLength(2); expect(map.teamSpawns.blue).toHaveLength(2);
      for (const base of Object.values(map.teamBases)) {
        expect(spawnable(map, base.position)).toBe(true);
        expect(base.protectionTiles).toHaveLength(3);
        expect(base.protectionTiles.every((index) => map.tiles[index] === 'brick')).toBe(true);
      }
      const points = [...map.teamSpawns.red, ...map.teamSpawns.blue, ...map.aiSpawns, ...map.powerUpSpawns];
      points.forEach((point) => expect.soft(spawnable(map, point), `${map.id} has a blocked activity point at ${point.x},${point.y}`).toBe(true));
    }
  });

  it('keeps every outer boundary sealed with steel', () => {
    for (const map of MAPS) {
      for (let x = 0; x < map.width; x++) { expect(map.tiles[x]).toBe('steel'); expect(map.tiles[(map.height - 1) * map.width + x]).toBe('steel'); }
      for (let y = 0; y < map.height; y++) { expect(map.tiles[y * map.width]).toBe('steel'); expect(map.tiles[y * map.width + map.width - 1]).toBe('steel'); }
    }
  });
});
