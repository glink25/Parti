import { describe, expect, it } from 'vitest';
import type { MapCorridor, MapRoom } from '../game/contracts';
import { buildDungeonTileMap, tileMapFingerprint } from './dungeonTiles';
import { RUINS_TILESET, validateTileSetManifest } from './tilesets/ruins';

const rooms: MapRoom[] = [
  { id: 'a', gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, template: 'standard', position: { x: 100, y: 100 }, width: 600, height: 400, connections: ['b'] },
  { id: 'b', gridX: 1, gridY: 0, gridWidth: 1, gridHeight: 1, template: 'standard', position: { x: 900, y: 100 }, width: 600, height: 400, connections: ['a'] },
];
const corridors: MapCorridor[] = [{ id: 'ab', fromRoomId: 'a', toRoomId: 'b', position: { x: 400, y: 240 }, width: 800, height: 120 }];

describe('dungeon tileset contract', () => {
  it('provides every fixed semantic slot with a gutter', () => {
    expect(validateTileSetManifest(RUINS_TILESET)).toEqual([]);
    expect(validateTileSetManifest(RUINS_TILESET, { naturalWidth: 1056, naturalHeight: 396 })).toEqual([]);
    expect(validateTileSetManifest(RUINS_TILESET, { naturalWidth: 1024, naturalHeight: 396 })).toContain('atlas dimensions do not match manifest');
    expect(RUINS_TILESET.gutter).toBeGreaterThanOrEqual(2);
    expect(new Set(Object.values(RUINS_TILESET.slots)).size).toBe(Object.keys(RUINS_TILESET.slots).length);
  });
});

describe('buildDungeonTileMap', () => {
  it('is deterministic and keeps decorations out of corridors', () => {
    const first = buildDungeonTileMap({ rooms, corridors, seed: 73, manifest: RUINS_TILESET });
    const second = buildDungeonTileMap({ rooms, corridors, seed: 73, manifest: RUINS_TILESET });
    expect(tileMapFingerprint(first)).toBe(tileMapFingerprint(second));
    expect(first.decorations.every((entry) => entry.roomId && !entry.corridorId)).toBe(true);
  });

  it('uses only floor variants for rooms and corridor variants for corridors', () => {
    const map = buildDungeonTileMap({ rooms, corridors, seed: 91, manifest: RUINS_TILESET });
    const floors = new Set(RUINS_TILESET.floorVariants.map((entry) => entry.slot));
    expect(map.surfaces.filter((entry) => entry.kind === 'room').every((entry) => floors.has(entry.slot))).toBe(true);
    expect(map.surfaces.filter((entry) => entry.kind === 'corridor').every((entry) => entry.slot === 'corridorHorizontal')).toBe(true);
  });

  it('leaves no wall across a room and corridor opening', () => {
    const map = buildDungeonTileMap({ rooms, corridors, seed: 15, manifest: RUINS_TILESET });
    const opening = { x1: 400, x2: 700, y: 300 };
    expect(map.walls.some((wall) => wall.side === 'east' && wall.x >= opening.x1 && wall.x <= opening.x2 && wall.y <= opening.y && wall.y + wall.h >= opening.y)).toBe(false);
    expect(map.doors.some((door) => door.slot === 'doorHorizontal')).toBe(true);
    expect(map.walls.some((wall) => wall.slot.startsWith('inner'))).toBe(true);
    expect(map.doors).toHaveLength(2);
    expect(map.doors.map((door) => [door.side, door.x]).sort()).toEqual([['east', 668], ['west', 868]]);
    expect(map.doors.some((door) => door.side === 'north' || door.side === 'south' || door.x === 400 || door.x === 1200)).toBe(false);
  });

  it('splits a wall exactly around a partial-tile opening', () => {
    const partial: MapCorridor[] = [{ ...corridors[0]!, position: { x: 650, y: 273 }, width: 300, height: 54 }];
    const map = buildDungeonTileMap({ rooms, corridors: partial, seed: 15, manifest: RUINS_TILESET });
    const east = map.walls.filter((wall) => wall.side === 'east' && wall.x === 700);
    expect(east.some((wall) => wall.y < 273 && wall.y + wall.h <= 273)).toBe(true);
    expect(east.some((wall) => wall.y >= 327)).toBe(true);
    expect(east.some((wall) => wall.y < 327 && wall.y + wall.h > 273)).toBe(false);
  });
});
