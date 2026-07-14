import type { MapCorridor, MapRoom } from '../game/contracts';
import type { DungeonTileSetManifest, DungeonTileSlot } from './tilesets/contracts';

type Rect = { x: number; y: number; w: number; h: number };
type SurfaceRect = Rect & { id: string; kind: 'room' | 'corridor'; fromRoomId?: string; toRoomId?: string };
export type SurfaceTile = Rect & { kind: 'room' | 'corridor'; roomId?: string; corridorId?: string; slot: DungeonTileSlot; sourceX: number; sourceY: number };
export type WallTile = Rect & { side: 'north' | 'south' | 'west' | 'east' | 'corner'; slot: DungeonTileSlot };
export type DecorationTile = Rect & { roomId: string; corridorId?: never; slot: DungeonTileSlot; alpha: number };
export type DungeonTileMap = { tileSize: number; width: number; height: number; surfaces: SurfaceTile[]; walls: WallTile[]; doors: WallTile[]; decorations: DecorationTile[] };

export function buildDungeonTileMap(input: { rooms: MapRoom[]; corridors: MapCorridor[]; seed: number; manifest: DungeonTileSetManifest; reservedRoomIds?: ReadonlySet<string>; reservedPositions?: Array<{ x: number; y: number; radius: number }> }): DungeonTileMap {
  const { rooms, corridors, seed, manifest } = input, size = manifest.tileSize;
  const roomRects = rooms.map((room) => ({ x: room.position.x, y: room.position.y, w: room.width, h: room.height, id: room.id, kind: 'room' as const }));
  const corridorRects = corridors.map((corridor) => ({ x: corridor.position.x, y: corridor.position.y, w: corridor.width, h: corridor.height, id: corridor.id, kind: 'corridor' as const, fromRoomId: corridor.fromRoomId, toRoomId: corridor.toRoomId }));
  const rects: SurfaceRect[] = [...roomRects, ...corridorRects], surfaceRects: SurfaceRect[] = [...corridorRects, ...roomRects];
  const surfaces: SurfaceTile[] = [];
  for (const rect of surfaceRects) {
    const startX = Math.floor(rect.x / size) * size, startY = Math.floor(rect.y / size) * size;
    for (let y = startY; y < rect.y + rect.h; y += size) for (let x = startX; x < rect.x + rect.w; x += size) {
      const left = Math.max(x, rect.x), top = Math.max(y, rect.y), right = Math.min(x + size, rect.x + rect.w), bottom = Math.min(y + size, rect.y + rect.h);
      if (right <= left || bottom <= top) continue;
      const slot = rect.kind === 'corridor' ? rect.w >= rect.h ? 'corridorHorizontal' : 'corridorVertical' : weightedFloor(manifest, hash(seed, rect.id, x, y));
      surfaces.push({ x: left, y: top, w: right - left, h: bottom - top, sourceX: left - x, sourceY: top - y, slot, kind: rect.kind, ...(rect.kind === 'room' ? { roomId: rect.id } : { corridorId: rect.id }) });
    }
  }
  const walls: WallTile[] = [], doors: WallTile[] = [], doorKeys = new Set<string>();
  for (const rect of rects) addWalls(walls, doors, doorKeys, rect, rects, size, manifest.wallDepth);
  const decorations: DecorationTile[] = [];
  for (const room of rooms) {
    if (room.id === 'room-0' || input.reservedRoomIds?.has(room.id) || room.width < size * 4 || room.height < size * 3) continue;
    const roll = hash(seed, room.id, 'decoration') / 0xffffffff;
    if (roll > manifest.decorationDensity) continue;
    const large = room.width >= size * 6 && room.height >= size * 4;
    const w = large ? size * 2 : size, h = w;
    const x = room.position.x + room.width / 2 - w / 2, y = room.position.y + room.height / 2 - h / 2;
    if (input.reservedPositions?.some((point) => Math.hypot(x + w / 2 - point.x, y + h / 2 - point.y) < point.radius + w * .7)) continue;
    decorations.push({ roomId: room.id, slot: large ? 'runeDecoration' : 'cornerDecoration', x, y, w, h, alpha: large ? .42 : .3 });
  }
  const width = Math.max(0, ...rects.map((rect) => rect.x + rect.w)), height = Math.max(0, ...rects.map((rect) => rect.y + rect.h));
  return { tileSize: size, width, height, surfaces, walls, doors, decorations };
}

function addWalls(target: WallTile[], doors: WallTile[], doorKeys: Set<string>, rect: SurfaceRect, all: SurfaceRect[], size: number, thickness: number) {
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const horizontal = side === 'north' || side === 'south', boundary = horizontal ? side === 'north' ? rect.y : rect.y + rect.h : side === 'west' ? rect.x : rect.x + rect.w;
    const start = horizontal ? rect.x : rect.y, end = start + (horizontal ? rect.w : rect.h), openings: Array<[number, number]> = [];
    for (const other of all) {
      if (other === rect) continue;
      const crosses = horizontal ? other.y < boundary + .01 && other.y + other.h > boundary - .01 : other.x < boundary + .01 && other.x + other.w > boundary - .01;
      if (!crosses) continue;
      const a = Math.max(start, horizontal ? other.x : other.y), b = Math.min(end, horizontal ? other.x + other.w : other.y + other.h);
      if (b - a > 1) openings.push([a, b]);
    }
    const merged = mergeIntervals(openings);
    for (const [a, b] of subtractIntervals(start, end, merged)) emitWallRun(target, side, boundary, a, b, size, thickness);
    if (rect.kind !== 'room') continue;
    for (const [a, b] of merged) {
      const connectedCorridor = all.some((other) => other.kind === 'corridor' && (other.fromRoomId === rect.id || other.toRoomId === rect.id) && (horizontal ? other.y < boundary + .01 && other.y + other.h > boundary - .01 && Math.min(b, other.x + other.w) - Math.max(a, other.x) > 1 : other.x < boundary + .01 && other.x + other.w > boundary - .01 && Math.min(b, other.y + other.h) - Math.max(a, other.y) > 1));
      if (!connectedCorridor) continue;
      const length = Math.min(size, b - a), center = (a + b) / 2, key = `${side}:${Math.round(boundary)}:${Math.round(center)}`;
      if (doorKeys.has(key)) continue; doorKeys.add(key);
      doors.push(horizontal ? { x: center - length / 2, y: boundary - thickness / 2, w: length, h: thickness, side, slot: 'doorVertical' } : { x: boundary - thickness / 2, y: center - length / 2, w: thickness, h: length, side, slot: 'doorHorizontal' });
      const cornerSlots: [DungeonTileSlot, DungeonTileSlot] = side === 'north' ? ['innerNorthWest', 'innerNorthEast'] : side === 'south' ? ['innerSouthWest', 'innerSouthEast'] : side === 'west' ? ['innerNorthWest', 'innerSouthWest'] : ['innerNorthEast', 'innerSouthEast'];
      if (horizontal) { target.push({ x: a - thickness / 2, y: boundary - thickness / 2, w: thickness, h: thickness, side: 'corner', slot: cornerSlots[0] }, { x: b - thickness / 2, y: boundary - thickness / 2, w: thickness, h: thickness, side: 'corner', slot: cornerSlots[1] }); }
      else { target.push({ x: boundary - thickness / 2, y: a - thickness / 2, w: thickness, h: thickness, side: 'corner', slot: cornerSlots[0] }, { x: boundary - thickness / 2, y: b - thickness / 2, w: thickness, h: thickness, side: 'corner', slot: cornerSlots[1] }); }
    }
  }
  const covered = (x: number, y: number) => all.some((other) => other !== rect && x >= other.x && x <= other.x + other.w && y >= other.y && y <= other.y + other.h);
  const corners = [
    [rect.x - thickness, rect.y - thickness, rect.x, rect.y, 'outerNorthWest'],
    [rect.x + rect.w, rect.y - thickness, rect.x + rect.w, rect.y, 'outerNorthEast'],
    [rect.x + rect.w, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h, 'outerSouthEast'],
    [rect.x - thickness, rect.y + rect.h, rect.x, rect.y + rect.h, 'outerSouthWest'],
  ] as const;
  for (const [x, y, sampleX, sampleY, slot] of corners) if (!covered(sampleX, sampleY)) target.push({ x, y, w: thickness, h: thickness, side: 'corner', slot });
}

function emitWallRun(target: WallTile[], side: 'north' | 'south' | 'west' | 'east', boundary: number, start: number, end: number, size: number, thickness: number) {
  for (let cursor = start; cursor < end; cursor += size) { const length = Math.min(size, end - cursor); target.push(side === 'north' || side === 'south' ? { x: cursor, y: side === 'north' ? boundary - thickness : boundary, w: length, h: thickness, side, slot: side === 'north' ? 'wallNorth' : 'wallSouth' } : { x: side === 'west' ? boundary - thickness : boundary, y: cursor, w: thickness, h: length, side, slot: side === 'west' ? 'wallWest' : 'wallEast' }); }
}
function mergeIntervals(intervals: Array<[number, number]>) { const sorted = intervals.slice().sort((a, b) => a[0] - b[0]), result: Array<[number, number]> = []; for (const interval of sorted) { const last = result[result.length - 1]; if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else result.push([...interval]); } return result; }
function subtractIntervals(start: number, end: number, openings: Array<[number, number]>) { const result: Array<[number, number]> = []; let cursor = start; for (const [a, b] of openings) { if (a > cursor) result.push([cursor, a]); cursor = Math.max(cursor, b); } if (cursor < end) result.push([cursor, end]); return result; }

function weightedFloor(manifest: DungeonTileSetManifest, roll: number) {
  const total = manifest.floorVariants.reduce((sum, entry) => sum + entry.weight, 0), value = roll % total;
  let cursor = 0;
  for (const entry of manifest.floorVariants) { cursor += entry.weight; if (value < cursor) return entry.slot; }
  return manifest.floorVariants[0]!.slot;
}

function hash(...values: Array<string | number>) { let h = 2166136261; for (const value of values) for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function tileMapFingerprint(map: DungeonTileMap) { return JSON.stringify([map.surfaces, map.walls, map.doors, map.decorations]); }
