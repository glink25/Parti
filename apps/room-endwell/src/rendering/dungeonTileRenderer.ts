import type { StageBlueprint } from '../game/contracts';
import { EndwellAssets } from './assets';
import { buildDungeonTileMap, type DungeonTileMap, type SurfaceTile } from './dungeonTiles';
import { RUINS_TILESET, tileSetFor } from './tilesets';
import { validateTileSetManifest, type DungeonTileSetManifest, type DungeonTileSlot } from './tilesets/contracts';

type Viewport = { x: number; y: number; w: number; h: number };
const CHUNK_SIZE = 512, BLEED = 2, MAX_CHUNKS = 28;

export class DungeonTileRenderer {
  private map: DungeonTileMap | null = null;
  private cacheKey = '';
  private chunks = new Map<string, HTMLCanvasElement>();
  private manifest: DungeonTileSetManifest = RUINS_TILESET;

  constructor(private readonly assets: EndwellAssets) {}

  render(c: CanvasRenderingContext2D, stage: StageBlueprint, viewport: Viewport, pixelRatio: number) {
    let manifest = tileSetFor(stage.themeId), image = this.assets.image(manifest.imageKey);
    if (!image || validateTileSetManifest(manifest, image).length) { manifest = RUINS_TILESET; image = this.assets.image(manifest.imageKey); }
    if (!image) { this.fallback(c, stage); return; }
    if (validateTileSetManifest(manifest, image).length) { this.fallback(c, stage); return; }
    this.manifest = manifest;
    const ratio = Math.max(1, Math.min(2, Math.round(pixelRatio * 2) / 2));
    const key = `${stage.fingerprint}:${stage.themeId}:${this.manifest.id}:${this.manifest.version}:${ratio}`;
    if (key !== this.cacheKey) {
      this.cacheKey = key; this.chunks.clear();
      this.map = buildDungeonTileMap({ rooms: stage.world.rooms, corridors: stage.world.corridors, seed: stage.stageSeed, manifest, reservedRoomIds: new Set([stage.boss.roomId, ...stage.objectives.map((objective) => objective.roomId)]), reservedPositions: [{ ...stage.world.spawn, radius: 180 }, { ...stage.merchant.position, radius: stage.merchant.radius }, { ...stage.forge.position, radius: stage.forge.radius }, ...stage.boss.runes.map((rune) => ({ ...rune.position, radius: 70 }))] });
    }
    const minX = Math.max(0, Math.floor((viewport.x - BLEED) / CHUNK_SIZE)), maxX = Math.min(Math.ceil(stage.world.width / CHUNK_SIZE) - 1, Math.floor((viewport.x + viewport.w + BLEED) / CHUNK_SIZE));
    const minY = Math.max(0, Math.floor((viewport.y - BLEED) / CHUNK_SIZE)), maxY = Math.min(Math.ceil(stage.world.height / CHUNK_SIZE) - 1, Math.floor((viewport.y + viewport.h + BLEED) / CHUNK_SIZE));
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const chunk = this.chunk(cx, cy, ratio, image, this.map!);
      c.drawImage(chunk, cx * CHUNK_SIZE - BLEED, cy * CHUNK_SIZE - BLEED, CHUNK_SIZE + BLEED * 2, CHUNK_SIZE + BLEED * 2);
    }
  }

  clear() { this.cacheKey = ''; this.map = null; this.chunks.clear(); }

  private chunk(cx: number, cy: number, ratio: number, image: HTMLImageElement, map: DungeonTileMap) {
    const key = `${cx}:${cy}`, cached = this.chunks.get(key);
    if (cached) { this.chunks.delete(key); this.chunks.set(key, cached); return cached; }
    const logicalSize = CHUNK_SIZE + BLEED * 2, canvas = document.createElement('canvas');
    canvas.width = Math.ceil(logicalSize * ratio); canvas.height = Math.ceil(logicalSize * ratio);
    const c = canvas.getContext('2d')!; c.setTransform(ratio, 0, 0, ratio, (-cx * CHUNK_SIZE + BLEED) * ratio, (-cy * CHUNK_SIZE + BLEED) * ratio); c.imageSmoothingEnabled = true;
    const bounds = { x: cx * CHUNK_SIZE - BLEED, y: cy * CHUNK_SIZE - BLEED, w: logicalSize, h: logicalSize };
    for (const wall of map.walls) if (intersects(wall, bounds)) this.drawSlot(c, image, wall.slot, wall.x, wall.y, wall.w, wall.h);
    for (const tile of map.surfaces) if (intersects(tile, bounds)) this.drawSurface(c, image, tile);
    for (const door of map.doors) if (intersects(door, bounds)) this.drawSlot(c, image, door.slot, door.x, door.y, door.w, door.h);
    for (const decoration of map.decorations) if (intersects(decoration, bounds)) { c.save(); c.globalAlpha = decoration.alpha; c.globalCompositeOperation = 'screen'; this.drawSlot(c, image, decoration.slot, decoration.x, decoration.y, decoration.w, decoration.h); c.restore(); }
    this.chunks.set(key, canvas); while (this.chunks.size > MAX_CHUNKS) this.chunks.delete(this.chunks.keys().next().value!);
    return canvas;
  }

  private drawSurface(c: CanvasRenderingContext2D, image: HTMLImageElement, tile: SurfaceTile) {
    const source = this.source(tile.slot);
    c.drawImage(image, source.x + tile.sourceX, source.y + tile.sourceY, tile.w, tile.h, tile.x, tile.y, tile.w, tile.h);
  }

  private drawSlot(c: CanvasRenderingContext2D, image: HTMLImageElement, slot: DungeonTileSlot, x: number, y: number, w: number, h: number) {
    const source = this.source(slot); c.drawImage(image, source.x, source.y, source.w, source.h, x, y, w, h);
    if (slot.startsWith('wall')) this.wallRelief(c, slot, x, y, w, h);
    else if (slot === 'doorHorizontal' || slot === 'doorVertical') this.doorRelief(c, slot, x, y, w, h);
  }

  private wallRelief(c: CanvasRenderingContext2D, slot: DungeonTileSlot, x: number, y: number, w: number, h: number) {
    const horizontal = slot === 'wallNorth' || slot === 'wallSouth', edge = slot === 'wallNorth' || slot === 'wallWest';
    c.save(); const shade = horizontal ? c.createLinearGradient(x, y, x, y + h) : c.createLinearGradient(x, y, x + w, y);
    shade.addColorStop(0, edge ? 'rgba(2,3,8,.88)' : 'rgba(43,39,50,.62)'); shade.addColorStop(.52, 'rgba(11,12,20,.72)'); shade.addColorStop(1, edge ? 'rgba(43,39,50,.62)' : 'rgba(2,3,8,.88)'); c.fillStyle = shade; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(177,147,85,.82)'; c.lineWidth = 3; c.beginPath(); if (horizontal) { const yy = edge ? y + h - 5 : y + 5; c.moveTo(x, yy); c.lineTo(x + w, yy); } else { const xx = edge ? x + w - 5 : x + 5; c.moveTo(xx, y); c.lineTo(xx, y + h); } c.stroke();
    c.strokeStyle = 'rgba(94,82,103,.48)'; c.lineWidth = 1; const step = 28; if (horizontal) for (let xx = x + step; xx < x + w; xx += step) { c.beginPath(); c.moveTo(xx, y + 9); c.lineTo(xx, y + h - 9); c.stroke(); } else for (let yy = y + step; yy < y + h; yy += step) { c.beginPath(); c.moveTo(x + 9, yy); c.lineTo(x + w - 9, yy); c.stroke(); } c.restore();
  }

  private doorRelief(c: CanvasRenderingContext2D, slot: DungeonTileSlot, x: number, y: number, w: number, h: number) {
    const horizontal = slot === 'doorVertical', cx = x + w / 2, cy = y + h / 2, opening = horizontal ? Math.min(76, w * .56) : Math.min(76, h * .56);
    c.save(); c.fillStyle = 'rgba(3,4,10,.94)'; if (horizontal) c.fillRect(cx - opening / 2, y, opening, h); else c.fillRect(x, cy - opening / 2, w, opening);
    c.strokeStyle = '#c3a45f'; c.lineWidth = 5; c.shadowColor = '#6dddf4'; c.shadowBlur = 8; c.beginPath(); if (horizontal) { c.moveTo(cx - opening / 2, y + h); c.lineTo(cx - opening / 2, y + 8); c.quadraticCurveTo(cx, y - 8, cx + opening / 2, y + 8); c.lineTo(cx + opening / 2, y + h); } else { c.moveTo(x + w, cy - opening / 2); c.lineTo(x + 8, cy - opening / 2); c.quadraticCurveTo(x - 8, cy, x + 8, cy + opening / 2); c.lineTo(x + w, cy + opening / 2); } c.stroke();
    c.strokeStyle = 'rgba(115,231,255,.82)'; c.lineWidth = 2; c.beginPath(); if (horizontal) { c.moveTo(cx - opening * .34, cy); c.lineTo(cx + opening * .34, cy); } else { c.moveTo(cx, cy - opening * .34); c.lineTo(cx, cy + opening * .34); } c.stroke(); c.fillStyle = '#c698ff'; c.beginPath(); c.arc(cx, cy, 5, 0, Math.PI * 2); c.fill(); c.restore();
  }

  private source(slot: DungeonTileSlot) {
    const span = this.manifest.tileSize + this.manifest.gutter * 2, index = this.manifest.slots[slot];
    return { x: index % this.manifest.columns * span + this.manifest.gutter, y: Math.floor(index / this.manifest.columns) * span + this.manifest.gutter, w: this.manifest.tileSize, h: this.manifest.tileSize };
  }

  private fallback(c: CanvasRenderingContext2D, stage: StageBlueprint) {
    c.fillStyle = '#171722'; for (const room of stage.world.rooms) c.fillRect(room.position.x, room.position.y, room.width, room.height);
    for (const corridor of stage.world.corridors) c.fillRect(corridor.position.x, corridor.position.y, corridor.width, corridor.height);
  }
}

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
