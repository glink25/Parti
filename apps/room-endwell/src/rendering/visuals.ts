import type { Element, EntityState, MapCorridor, MapRoom, PlayerState, TerrainState, Vec2 } from '../game/contracts';
import { EndwellAssets, TILE_SPRITES, tileSource, type TileSprite } from './assets';

export const ELEMENT_COLORS: Record<Element, string> = { rock: '#b6926a', fire: '#ff6547', ice: '#7de9ff', life: '#75e88c', lightning: '#bd91ff', water: '#4aa5ff', shield: '#ffe06b' };

export class EndwellVisuals {
  constructor(readonly assets: EndwellAssets) {}

  tile(c: CanvasRenderingContext2D, sprite: TileSprite, x: number, y: number, options: { flip?: boolean; alpha?: number; tint?: string } = {}) {
    const image = this.assets.image('dungeon'); if (!image) return false;
    const source = tileSource(sprite.tile), anchor = sprite.anchorY ?? 0;
    c.save(); c.globalAlpha *= options.alpha ?? 1; c.imageSmoothingEnabled = false; c.translate(x, y + anchor);
    if (options.flip) c.scale(-1, 1);
    c.drawImage(image, source.x, source.y, source.w, source.h, -sprite.drawWidth / 2, -sprite.drawHeight / 2, sprite.drawWidth, sprite.drawHeight);
    if (options.tint) { c.globalCompositeOperation = 'source-atop'; c.fillStyle = options.tint; c.globalAlpha *= .28; c.fillRect(-sprite.drawWidth / 2, -sprite.drawHeight / 2, sprite.drawWidth, sprite.drawHeight); }
    c.restore(); return true;
  }

  floor(c: CanvasRenderingContext2D, rooms: MapRoom[], corridors: MapCorridor[], stageIndex: number) {
    const image = this.assets.image('dungeon'), floor = tileSource(48);
    const paintFloor = (x: number, y: number, w: number, h: number) => {
      c.fillStyle = ['#211c2b', '#191e2e', '#271a25'][stageIndex % 3]!; c.fillRect(x, y, w, h);
      if (image) { c.save(); c.imageSmoothingEnabled = false; c.globalAlpha = .3; for (let yy = y; yy < y + h; yy += 48) for (let xx = x; xx < x + w; xx += 48) c.drawImage(image, floor.x, floor.y, 16, 16, xx, yy, Math.min(48, x + w - xx), Math.min(48, y + h - yy)); c.restore(); }
    };
    for (const room of rooms) { paintFloor(room.position.x, room.position.y, room.width, room.height); c.strokeStyle = '#536078'; c.lineWidth = 16; c.strokeRect(room.position.x, room.position.y, room.width, room.height); c.strokeStyle = '#171421'; c.lineWidth = 7; c.strokeRect(room.position.x + 8, room.position.y + 8, room.width - 16, room.height - 16); }
    // Corridors are deliberately painted last: their floor cuts clean openings through room walls.
    for (const corridor of corridors) { paintFloor(corridor.position.x, corridor.position.y, corridor.width, corridor.height); c.strokeStyle = '#536078'; c.lineWidth = 8; if (corridor.width > corridor.height) { c.beginPath(); c.moveTo(corridor.position.x, corridor.position.y); c.lineTo(corridor.position.x + corridor.width, corridor.position.y); c.moveTo(corridor.position.x, corridor.position.y + corridor.height); c.lineTo(corridor.position.x + corridor.width, corridor.position.y + corridor.height); c.stroke(); } else { c.beginPath(); c.moveTo(corridor.position.x, corridor.position.y); c.lineTo(corridor.position.x, corridor.position.y + corridor.height); c.moveTo(corridor.position.x + corridor.width, corridor.position.y); c.lineTo(corridor.position.x + corridor.width, corridor.position.y + corridor.height); c.stroke(); } }
  }

  terrain(c: CanvasRenderingContext2D, terrain: TerrainState) {
    if (terrain.kind === 'safe-zone') this.aura(c, terrain.position, terrain.radius, '#65f3dc', .18);
    if (terrain.kind === 'obstacle' || terrain.kind === 'rune-wall') { this.stoneObstacle(c, terrain); return; }
    if (terrain.kind === 'falling-rock') { const active = Boolean(terrain.activatesAt && Date.now() >= terrain.activatesAt); this.aura(c, terrain.position, terrain.radius, '#ff7958', active ? .38 : .15); this.rockPile(c, terrain.position, terrain.radius, active); return; }
    this.tile(c, TILE_SPRITES.rune, terrain.position.x, terrain.position.y, { tint: terrain.kind === 'rune' ? '#c79cff' : '#65f3dc' });
  }

  player(c: CanvasRenderingContext2D, pos: Vec2, player: PlayerState, local: boolean, moving: boolean) {
    const now = performance.now(), bob = player.alive ? Math.sin(now / 180 + hash(player.id)) * (moving ? 3 : 1.5) : 9, casting = player.cast.phase === 'chanting' || player.cast.phase === 'active';
    c.save(); c.globalAlpha = player.alive ? 1 : .42; c.translate(pos.x, pos.y); c.scale(casting ? 1 + Math.sin(now / 70) * .06 : 1, casting ? 1 - Math.sin(now / 70) * .04 : 1); c.translate(-pos.x, -pos.y);
    c.fillStyle = player.alive ? local ? '#ffe69a55' : '#76b8ff44' : '#7774'; c.beginPath(); c.ellipse(pos.x, pos.y + 21, local ? 26 : 22, 9, 0, 0, Math.PI * 2); c.fill();
    this.tile(c, local ? TILE_SPRITES.player : TILE_SPRITES.ally, pos.x, pos.y + bob, { flip: player.aim.x < 0, tint: local ? '#ffe9a3' : '#78aaff' }); c.restore();
    if (player.shields.length) { c.strokeStyle = '#ffe06b'; c.lineWidth = 4; c.beginPath(); c.arc(pos.x, pos.y, 32 + Math.sin(now / 120) * 2, 0, Math.PI * 2); c.stroke(); }
  }

  monster(c: CanvasRenderingContext2D, entity: EntityState, pos: Vec2) {
    const sprite = entity.boss ? TILE_SPRITES.boss : entity.monsterDefinitionId === 'ruins.shooter' ? TILE_SPRITES.shooter : entity.monsterDefinitionId === 'ruins.guardian' ? TILE_SPRITES.guardian : TILE_SPRITES.chaser;
    const now = performance.now(), pulse = entity.cast.phase === 'chanting' ? 1 + Math.sin(now / 70) * .08 : 1, bob = Math.sin(now / 210 + hash(entity.id)) * 2;
    if (entity.boss) { this.aura(c, pos, entity.radius + 22 + Math.sin(now / 180) * 5, '#e04f78', .2); for (let i = 0; i < 5; i++) { const a = now / 900 + i * Math.PI * .4; this.softParticle(c, 'blackSmoke', { x: pos.x + Math.cos(a) * 66, y: pos.y + Math.sin(a) * 38 }, 42, now + i * 80, .28); } }
    c.save(); c.translate(pos.x, pos.y); c.scale(pulse, pulse); c.translate(-pos.x, -pos.y); this.tile(c, sprite, pos.x, pos.y + bob, { flip: (entity.direction?.x ?? -1) > 0, tint: entity.elite ? '#bd82ff' : entity.boss ? '#ff557e' : undefined }); c.restore();
  }

  effect(c: CanvasRenderingContext2D, entity: EntityState, pos: Vec2, beamSegments: Array<{ from: Vec2; to: Vec2 }> = []) {
    const element = entity.source?.spell.elements.find((e) => !['rock', 'shield', 'life'].includes(e)) ?? entity.source?.spell.elements[0] ?? 'rock', color = ELEMENT_COLORS[element], age = Date.now() - entity.createdAt;
    if (entity.source?.spell.delivery === 'beam') { c.save(); c.globalCompositeOperation = 'screen'; c.shadowBlur = 18; c.shadowColor = color; for (const segment of beamSegments) { c.strokeStyle = `${color}55`; c.lineWidth = Math.max(14, (entity.source.spell.beam?.width ?? 10) * 2.5); line(c, segment.from, segment.to); c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, (entity.source.spell.beam?.width ?? 10) * .42); line(c, segment.from, segment.to); if (element === 'lightning') this.lightning(c, segment.from, segment.to, color, entity.id); } c.restore(); return; }
    if (entity.source?.spell.delivery === 'spray') { const d = entity.direction ?? { x: 1, y: 0 }, angle = Math.atan2(d.y, d.x), half = (entity.source.spell.coneAngle ?? Math.PI / 2) / 2; c.fillStyle = `${color}35`; c.beginPath(); c.moveTo(entity.position.x, entity.position.y); c.arc(entity.position.x, entity.position.y, entity.source.spell.range, angle - half, angle + half); c.closePath(); c.fill(); for (let i = 0; i < 8; i++) { const a = angle - half + ((i + .5) / 8) * half * 2, r = entity.source.spell.range * (.25 + ((hash(entity.id + i) % 70) / 100)); this.softParticle(c, element === 'fire' ? 'explosion' : 'whitePuff', { x: entity.position.x + Math.cos(a) * r, y: entity.position.y + Math.sin(a) * r }, 34, age + i * 45, .34); } return; }
    if (entity.kind === 'wall') { for (let y = pos.y - 62; y <= pos.y + 62; y += 28) { c.fillStyle = entity.archetype === 'ice-wall' ? '#8cecffaa' : '#8a7669'; c.beginPath(); c.moveTo(pos.x - 18, y + 15); c.lineTo(pos.x, y - 18); c.lineTo(pos.x + 18, y + 15); c.closePath(); c.fill(); } return; }
    if (entity.kind === 'warning') { c.strokeStyle = '#ffd36a'; c.lineWidth = 4; c.setLineDash([10, 8]); c.beginPath(); c.arc(pos.x, pos.y, entity.radius * (.88 + Math.sin(age / 80) * .06), 0, Math.PI * 2); c.stroke(); c.setLineDash([]); return; }
    if (entity.kind === 'area' || entity.kind === 'field') { this.aura(c, pos, entity.radius, color, .2); this.softParticle(c, element === 'fire' ? 'explosion' : element === 'lightning' ? 'flash' : element === 'rock' ? 'blackSmoke' : 'whitePuff', pos, entity.radius * 1.65, age, .45); return; }
    if (entity.kind === 'projectile') { const trail = entity.velocity ?? { x: 0, y: 0 }; c.save(); c.globalCompositeOperation = 'screen'; c.strokeStyle = `${color}88`; c.lineWidth = entity.radius * 1.2; line(c, { x: pos.x - trail.x * .08, y: pos.y - trail.y * .08 }, pos); c.shadowBlur = 16; c.shadowColor = color; c.fillStyle = color; c.beginPath(); c.arc(pos.x, pos.y, entity.radius, 0, Math.PI * 2); c.fill(); c.restore(); this.softParticle(c, element === 'fire' ? 'flash' : 'whitePuff', pos, entity.radius * 2.8, age, .45); }
  }

  softParticle(c: CanvasRenderingContext2D, key: 'explosion' | 'flash' | 'whitePuff' | 'blackSmoke', pos: Vec2, size: number, elapsed: number, alpha = .5) { const image = this.assets.frame(key, elapsed); if (!image) return; c.save(); c.imageSmoothingEnabled = true; c.globalCompositeOperation = key === 'blackSmoke' ? 'source-over' : 'screen'; c.globalAlpha = alpha; c.drawImage(image, pos.x - size / 2, pos.y - size / 2, size, size); c.restore(); }
  aura(c: CanvasRenderingContext2D, pos: Vec2, radius: number, color: string, alpha: number) { const gradient = c.createRadialGradient(pos.x, pos.y, radius * .1, pos.x, pos.y, radius); gradient.addColorStop(0, colorWithAlpha(color, alpha * 1.8)); gradient.addColorStop(1, colorWithAlpha(color, 0)); c.fillStyle = gradient; c.beginPath(); c.arc(pos.x, pos.y, radius, 0, Math.PI * 2); c.fill(); }
  private stoneObstacle(c: CanvasRenderingContext2D, terrain: TerrainState) { const width = terrain.width ?? Math.max(72, terrain.radius * 1.45), height = terrain.height ?? Math.max(60, terrain.radius * 1.15), left = terrain.position.x - width / 2, top = terrain.position.y - height / 2, brickH = 24; c.save(); c.fillStyle = '#303747'; c.strokeStyle = '#11141d'; c.lineWidth = 4; c.fillRect(left, top, width, height); c.strokeRect(left, top, width, height); for (let row = 0, y = top; y < top + height; row++, y += brickH) { const offset = row % 2 ? -22 : 0; for (let x = left + offset; x < left + width; x += 44) { c.fillStyle = row % 2 ? '#566278' : '#657189'; c.fillRect(Math.max(left, x) + 2, y + 2, Math.min(40, left + width - Math.max(left, x) - 2), Math.min(brickH - 4, top + height - y - 2)); } } if (terrain.kind === 'rune-wall') { c.globalCompositeOperation = 'screen'; c.strokeStyle = '#b287ff'; c.lineWidth = 3; c.beginPath(); c.moveTo(terrain.position.x, top + 8); c.lineTo(terrain.position.x - 10, terrain.position.y); c.lineTo(terrain.position.x + 10, terrain.position.y); c.lineTo(terrain.position.x, top + height - 8); c.stroke(); } c.restore(); }
  private rockPile(c: CanvasRenderingContext2D, pos: Vec2, radius: number, active: boolean) { c.save(); c.fillStyle = active ? '#765044' : '#696373'; c.strokeStyle = '#24212d'; c.lineWidth = 3; for (let i = 0; i < 7; i++) { const angle = i / 7 * Math.PI * 2, r = radius * (.2 + (hash(i) % 35) / 100), size = radius * (.2 + (hash(i + 20) % 18) / 100); c.beginPath(); c.arc(pos.x + Math.cos(angle) * r, pos.y + Math.sin(angle) * r * .65, size, 0, Math.PI * 2); c.fill(); c.stroke(); } c.restore(); }
  private lightning(c: CanvasRenderingContext2D, from: Vec2, to: Vec2, color: string, seed: string) { c.strokeStyle = color; c.lineWidth = 3; c.beginPath(); c.moveTo(from.x, from.y); for (let i = 1; i < 7; i++) { const t = i / 7, wobble = ((hash(`${seed}:${i}:${Math.floor(performance.now() / 80)}`) % 21) - 10); c.lineTo(from.x + (to.x - from.x) * t + wobble, from.y + (to.y - from.y) * t - wobble); } c.lineTo(to.x, to.y); c.stroke(); }
}

function line(c: CanvasRenderingContext2D, from: Vec2, to: Vec2) { c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke(); }
function hash(value: string | number) { let h = 2166136261; for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function hexAlpha(value: number) { return Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0'); }
export function colorWithAlpha(color: string, alpha: number) { const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color); if (!match) return color; const hex = match[1]!, normalized = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex; return `#${normalized}${hexAlpha(alpha)}`; }
