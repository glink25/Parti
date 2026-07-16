import type { BasePlacement, Facing, FfaLayout, MapDefinition, Point, Tile } from './contracts';

const W = 26;
const H = 20;
const point = (x: number, y: number): Point => ({ x: x + .5, y: y + .5 });
const indexOf = (x: number, y: number) => y * W + x;

type Painter = {
  tiles: Tile[];
  set(x: number, y: number, tile: Tile): void;
  rect(x: number, y: number, width: number, height: number, tile: Tile): void;
  h(y: number, x1: number, x2: number, tile: Tile, gaps?: number[]): void;
  v(x: number, y1: number, y2: number, tile: Tile, gaps?: number[]): void;
};

function painter(): Painter {
  const tiles = Array<Tile>(W * H).fill('ground');
  const set = (x: number, y: number, tile: Tile) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[indexOf(x, y)] = tile; };
  return {
    tiles, set,
    rect(x, y, width, height, tile) { for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) set(px, py, tile); },
    h(y, x1, x2, tile, gaps = []) { for (let x = x1; x <= x2; x++) if (!gaps.includes(x)) set(x, y, tile); },
    v(x, y1, y2, tile, gaps = []) { for (let y = y1; y <= y2; y++) if (!gaps.includes(y)) set(x, y, tile); },
  };
}

function fortress(p: Painter, x: number, y: number, facing: Facing): BasePlacement {
  const bricks: Array<[number, number]> = [];
  const steel: Array<[number, number]> = [];
  if (facing === 'right') { bricks.push([x - 1, y - 1], [x - 1, y], [x - 1, y + 1]); steel.push([x, y - 1], [x, y + 1]); }
  if (facing === 'left') { bricks.push([x + 1, y - 1], [x + 1, y], [x + 1, y + 1]); steel.push([x, y - 1], [x, y + 1]); }
  if (facing === 'down') { bricks.push([x - 1, y - 1], [x, y - 1], [x + 1, y - 1]); steel.push([x - 1, y], [x + 1, y]); }
  if (facing === 'up') { bricks.push([x - 1, y + 1], [x, y + 1], [x + 1, y + 1]); steel.push([x - 1, y], [x + 1, y]); }
  bricks.forEach(([bx, by]) => p.set(bx, by, 'brick'));
  steel.forEach(([sx, sy]) => p.set(sx, sy, 'steel'));
  p.set(x, y, 'ground');
  return { position: point(x, y), facing, protectionTiles: bricks.map(([bx, by]) => indexOf(bx, by)) };
}

function layouts(p: Painter) {
  const top = fortress(p, 13, 2, 'down');
  const bottom = fortress(p, 13, 17, 'up');
  const left = fortress(p, 3, 10, 'right');
  const right = fortress(p, 22, 10, 'left');
  const lowerLeft = fortress(p, 5, 16, 'right');
  const lowerRight = fortress(p, 20, 16, 'left');
  const make = (bases: BasePlacement[], spawns: Point[]): FfaLayout => ({ bases, spawns });
  const ffaLayouts: Record<2 | 3 | 4, FfaLayout> = {
    2: make([top, bottom], [point(13, 4), point(13, 15)]),
    3: make([top, lowerLeft, lowerRight], [point(13, 4), point(7, 16), point(18, 16)]),
    4: make([top, bottom, left, right], [point(13, 4), point(13, 15), point(5, 10), point(20, 10)]),
  };
  return {
    ffaLayouts,
    teamBases: { red: left, blue: right },
    teamSpawns: { red: [point(5, 8), point(5, 12)], blue: [point(20, 8), point(20, 12)] },
  };
}

function finish(id: string, name: string, draw: (p: Painter) => void): MapDefinition {
  const p = painter();
  for (let x = 0; x < W; x++) { p.set(x, 0, 'steel'); p.set(x, H - 1, 'steel'); }
  for (let y = 0; y < H; y++) { p.set(0, y, 'steel'); p.set(W - 1, y, 'steel'); }
  draw(p);
  const placement = layouts(p);
  const clear = (pos: Point) => p.set(Math.floor(pos.x), Math.floor(pos.y), 'ground');
  Object.values(placement.ffaLayouts).forEach((layout) => layout.spawns.forEach(clear));
  placement.teamSpawns.red.forEach(clear); placement.teamSpawns.blue.forEach(clear);
  const aiSpawns = [point(10, 2), point(15, 17), point(2, 7), point(23, 12)];
  const powerUpSpawns = [point(8, 5), point(17, 5), point(8, 14), point(17, 14), point(12, 9)];
  aiSpawns.forEach(clear); powerUpSpawns.forEach(clear);
  return {
    id, name, width: W, height: H, tiles: p.tiles, ...placement, center: point(12, 9),
    aiSpawns, powerUpSpawns,
  };
}

export const MAPS: MapDefinition[] = [
  finish('crossfire', '中央争夺', (p) => { p.h(7, 5, 20, 'brick', [9, 10, 15, 16]); p.h(12, 5, 20, 'brick', [9, 10, 15, 16]); p.v(10, 4, 15, 'brick', [8, 9, 10, 11]); p.v(15, 4, 15, 'brick', [8, 9, 10, 11]); p.rect(12, 8, 2, 4, 'forest'); }),
  finish('twin-flanks', '双侧翼', (p) => { p.v(8, 3, 16, 'steel', [6, 7, 12, 13]); p.v(17, 3, 16, 'steel', [6, 7, 12, 13]); p.h(6, 9, 16, 'brick', [12, 13]); p.h(13, 9, 16, 'brick', [12, 13]); p.rect(3, 4, 3, 2, 'forest'); p.rect(20, 14, 3, 2, 'forest'); }),
  finish('river-bridges', '河桥鏖战', (p) => { p.rect(11, 1, 4, 18, 'water'); p.rect(11, 4, 4, 3, 'ground'); p.rect(11, 9, 4, 2, 'ground'); p.rect(11, 14, 4, 3, 'ground'); p.h(8, 3, 9, 'brick', [6]); p.h(11, 16, 22, 'brick', [19]); }),
  finish('steel-maze', '钢墙迷宫', (p) => { p.v(7, 3, 16, 'steel', [5, 10, 14]); p.v(12, 2, 17, 'steel', [6, 9, 13]); p.v(18, 3, 16, 'steel', [5, 10, 14]); p.h(6, 3, 22, 'brick', [7, 8, 12, 13, 18, 19]); p.h(13, 3, 22, 'brick', [5, 6, 11, 12, 17, 18]); }),
  finish('forest-ambush', '森林伏击', (p) => { p.rect(6, 4, 5, 4, 'forest'); p.rect(15, 12, 5, 4, 'forest'); p.rect(6, 13, 4, 3, 'forest'); p.rect(16, 4, 4, 3, 'forest'); p.h(9, 5, 20, 'brick', [8, 12, 13, 17]); p.h(11, 5, 20, 'brick', [8, 12, 13, 17]); }),
  finish('ice-ring', '冰面环路', (p) => { p.rect(6, 4, 14, 12, 'ice'); p.rect(9, 7, 8, 6, 'ground'); p.h(6, 8, 17, 'brick', [12, 13]); p.h(13, 8, 17, 'brick', [12, 13]); p.v(8, 7, 12, 'steel', [9, 10]); p.v(17, 7, 12, 'steel', [9, 10]); }),
  finish('brick-city', '砖墙城区', (p) => { [[5,4],[10,3],[16,4],[20,7],[5,12],[10,14],[16,13],[20,11]].forEach(([x,y]) => p.rect(x, y, 3, 2, 'brick')); p.h(9, 3, 22, 'brick', [6, 7, 12, 13, 18, 19]); p.h(11, 3, 22, 'brick', [4, 5, 10, 11, 16, 17, 22]); }),
  finish('four-quadrants', '四区通道', (p) => { p.v(12, 2, 17, 'water', [5, 9, 10, 14]); p.v(13, 2, 17, 'water', [5, 9, 10, 14]); p.h(9, 3, 22, 'steel', [6, 12, 13, 19]); p.h(10, 3, 22, 'steel', [6, 12, 13, 19]); p.rect(5, 4, 3, 3, 'forest'); p.rect(18, 13, 3, 3, 'forest'); }),
  finish('broken-factory', '破碎工厂', (p) => { p.rect(5, 4, 5, 2, 'steel'); p.rect(16, 14, 5, 2, 'steel'); p.rect(7, 12, 4, 2, 'brick'); p.rect(15, 5, 4, 2, 'brick'); p.v(12, 3, 16, 'brick', [6, 9, 10, 13]); p.v(14, 3, 16, 'brick', [5, 9, 10, 14]); p.rect(3, 8, 4, 4, 'forest'); }),
  finish('open-arena', '开放战场', (p) => { p.rect(10, 7, 6, 6, 'forest'); p.h(5, 5, 20, 'brick', [8, 9, 13, 14, 18]); p.h(14, 5, 20, 'brick', [7, 11, 12, 16, 17]); p.rect(6, 8, 2, 4, 'steel'); p.rect(18, 8, 2, 4, 'steel'); }),
];

export const MAP_BY_ID = new Map(MAPS.map((map) => [map.id, map]));

export function tileAt(map: MapDefinition, x: number, y: number): Tile {
  const tx = Math.floor(x); const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 'steel';
  return map.tiles[ty * map.width + tx];
}
