import {
  Color, Sound, TileLayer, drawLine, drawRect, drawText, drawTextScreen, mainCanvasSize,
  setCameraPos, setCameraScale, vec2, type Vector2,
} from 'littlejsengine';
import type { BaseState, Direction, GameState, PlayerState, Point, Tile } from '../game/contracts';
import { MAP_BY_ID } from '../game/maps';
import { clampCameraTarget, smoothCamera, waitingCameraTarget } from './camera';

const colors = {
  ground: new Color(.06, .08, .07), brick: new Color(.64, .25, .16), steel: new Color(.58, .64, .62),
  water: new Color(.08, .28, .62), forest: new Color(.08, .34, .13), ice: new Color(.55, .78, .88),
  red: new Color(.92, .25, .16), blue: new Color(.2, .48, .95), gold: new Color(1, .78, .18),
  white: new Color(1, 1, .9), dark: new Color(.04, .05, .04), ai: new Color(.72, .7, .68),
};

export const sounds = {
  fire: new Sound([.35, .04, 190, .01, .04, .08, 2, 2, -8]),
  explosion: new Sound([.6, .08, 70, .02, .16, .3, 4, 1.8, -2]),
  pickup: new Sound([.35, 0, 520, .01, .05, .12, 1, 1.8, 12]),
};

let groundLayer: TileLayer | null = null;
let layerKey = '';
let activeMapHeight = 20;
let cameraPosition: Point | null = null;
let cameraMapId = '';

const world = (x: number, y: number): Vector2 => vec2(x, activeMapHeight - y);

function tileColor(tile: Tile): Color { return colors[tile]; }

function drawActorRect(pos: Vector2, size: Vector2, color: Color, angle = 0): void {
  drawRect(pos, size, color, angle, false);
}

function drawActorLine(posA: Vector2, posB: Vector2, width: number, color: Color): void {
  drawLine(posA, posB, width, color, undefined, 0, false);
}

function rebuildLayer(state: GameState): void {
  const map = MAP_BY_ID.get(state.config.mapId);
  if (!map) return;
  activeMapHeight = map.height;
  const now = Date.now();
  const fortifiedTiles = new Set(Object.values(state.bases)
    .filter((base) => base.fortifiedUntil > now)
    .flatMap((base) => base.protectionTiles));
  const key = `${map.id}:${state.destroyedTiles.join(',')}:fortified:${[...fortifiedTiles].sort((a, b) => a - b).join(',')}`;
  if (key === layerKey) return;
  layerKey = key; groundLayer?.destroy();
  groundLayer = new TileLayer(vec2(), vec2(map.width, map.height), undefined, -100, false);
  groundLayer.redrawStart(true);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const index = y * map.width + x;
    const originalTile = state.destroyedTiles.includes(index) ? 'ground' : map.tiles[index];
    const tile = fortifiedTiles.has(index) && originalTile === 'brick' ? 'steel' : originalTile;
    const pos = world(x + .5, y + .5);
    groundLayer.drawRect(pos, vec2(1.02), tile === 'forest' ? colors.ground : tileColor(tile));
    if (tile === 'brick') {
      groundLayer.drawRect(world(x + .25, y + .25), vec2(.46, .18), new Color(.88, .42, .2));
      groundLayer.drawRect(world(x + .72, y + .68), vec2(.46, .18), new Color(.39, .12, .08));
    }
    if (tile === 'steel') groundLayer.drawRect(pos, vec2(.72), new Color(.35, .4, .4));
    if (tile === 'water') for (let line = 0; line < 3; line++) groundLayer.drawRect(world(x + .5, y + .22 + line * .28), vec2(.75, .06), new Color(.18, .58, .9));
  }
  groundLayer.redrawEnd();
}

export function configureCamera(): void { setCameraPos(vec2(13, 10)); setCameraScale(44); }

export function updateCamera(state: GameState | null, myId: string | null, predicted?: Point): void {
  if (!state || state.phase === 'lobby' || !myId) return;
  const map = MAP_BY_ID.get(state.config.mapId); const player = state.players[myId];
  if (!map || !player) return;
  let target: Point = predicted ?? player;
  if (!player.alive && !player.eliminated) {
    const base = state.config.mode === 'team2v2' ? state.bases[`team:${player.team}`] : state.bases[`player:${player.id}`];
    if (base) target = waitingCameraTarget(player, base);
  }
  target = clampCameraTarget(target, map.width, map.height);
  if (!cameraPosition || cameraMapId !== map.id) { cameraPosition = target; cameraMapId = map.id; }
  else cameraPosition = smoothCamera(cameraPosition, target);
  setCameraPos(world(cameraPosition.x, cameraPosition.y));
}

function directionAngle(direction: Direction): number {
  return direction === 'up' ? 0 : direction === 'right' ? -Math.PI / 2 : direction === 'down' ? Math.PI : Math.PI / 2;
}

function drawPixelTank(pos: Vector2, direction: Direction, color: Color): void {
  const angle = directionAngle(direction);
  drawActorRect(pos, vec2(1.08, 1.04), colors.white, angle);
  drawActorRect(pos, vec2(.98, .94), colors.dark, angle);
  drawActorRect(pos, vec2(.68, .82), color, angle);
  const horizontal = direction === 'left' || direction === 'right';
  const trackSize = horizontal ? vec2(.72, .16) : vec2(.16, .72);
  const trackA = horizontal ? vec2(0, .37) : vec2(.37, 0);
  drawActorRect(pos.add(trackA), trackSize, colors.gold);
  drawActorRect(pos.subtract(trackA), trackSize, colors.gold);
  drawActorRect(pos, vec2(.34), colors.white);
  const d = direction === 'up' ? vec2(0, .42) : direction === 'down' ? vec2(0, -.42) : direction === 'left' ? vec2(-.42, 0) : vec2(.42, 0);
  drawActorLine(pos, pos.add(d.scale(1.25)), .16, colors.dark);
  drawActorLine(pos, pos.add(d.scale(1.2)), .09, colors.white);
}

function drawTank(player: PlayerState): void {
  if (!player.alive) return;
  const pos = world(player.x, player.y); const color = player.team === 'red' ? colors.red : colors.blue;
  drawPixelTank(pos, player.direction, color);
  if (player.shieldUntil > Date.now()) drawActorRect(pos, vec2(.98), new Color(.3, .8, 1, .22));
  drawText(player.name.slice(0, 10), pos.add(vec2(0, -.62)), .23, colors.white, .04, colors.dark);
}

function drawBase(base: BaseState): void {
  const pos = world(base.x, base.y); const color = base.hp ? (base.team === 'blue' ? colors.blue : base.team === 'red' ? colors.red : colors.gold) : new Color(.18, .15, .12);
  drawActorRect(pos, vec2(1.14), colors.white); drawActorRect(pos, vec2(1.02), colors.dark); drawActorRect(pos, vec2(.84), color);
  drawActorRect(pos.add(vec2(0, .08)), vec2(.22, .54), colors.dark); drawActorRect(pos.add(vec2(-.24, -.13)), vec2(.58, .18), colors.dark);
  if (base.hp) drawText(`B${base.hp}`, pos, .3, colors.white, .05, colors.dark);
}

export function prepareWorld(state: GameState | null): void {
  if (!state || state.phase === 'lobby') return;
  rebuildLayer(state);
}

export function renderActors(state: GameState | null, myId: string | null, predicted?: { x: number; y: number }): void {
  if (!state || state.phase === 'lobby') return;
  Object.values(state.bases).forEach(drawBase);
  Object.values(state.powerUps).forEach((item) => {
    const pos = world(item.x, item.y); drawActorRect(pos, vec2(.58), colors.gold, Math.PI / 4); drawText(item.kind[0].toUpperCase(), pos, .28, colors.dark);
  });
  Object.values(state.ai).forEach((ai) => {
    drawPixelTank(world(ai.x, ai.y), ai.direction, colors.ai);
  });
  Object.values(state.players).forEach((player) => drawTank(player.id === myId && predicted ? { ...player, ...predicted } : player));
  function drawBullet(x: number, y: number, color: Color): void {
    const pos = world(x, y); drawActorRect(pos, vec2(.4), colors.dark); drawActorRect(pos, vec2(.26), color); drawActorRect(pos, vec2(.1), colors.white);
  }
  Object.values(state.bullets).forEach((bullet) => drawBullet(bullet.x, bullet.y, bullet.ownerKind === 'ai' ? colors.white : colors.gold));
  const map = MAP_BY_ID.get(state.config.mapId);
  if (map) for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const index = y * map.width + x;
    if (map.tiles[index] === 'forest' && !state.destroyedTiles.includes(index)) {
      drawActorRect(world(x + .5, y + .5), vec2(1.06), new Color(.05, .35, .1, .82));
      drawActorRect(world(x + .3, y + .35), vec2(.28), new Color(.2, .55, .18, .8));
    }
  }
}

export function renderHud(state: GameState | null, myId: string | null): void {
  if (!state || state.phase === 'lobby') return;
  const me = myId ? state.players[myId] : undefined;
  drawTextScreen(`击毁 ${me?.kills ?? 0}  AI ${me?.aiKills ?? 0}`, vec2(16, 24), 18, colors.white, 3, colors.dark, 'left');
  const seconds = state.deadlineAt ? Math.max(0, Math.ceil((state.deadlineAt - Date.now()) / 1000)) : 0;
  drawTextScreen(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, vec2(mainCanvasSize.x / 2, 24), 20, colors.gold, 3, colors.dark);
  if (!me?.alive && !me?.eliminated && me?.respawnAt) drawTextScreen('准备重新部署', mainCanvasSize.scale(.5), 30, colors.white, 5, colors.dark);
  if (me?.eliminated) drawTextScreen('基地失守 · 最后一命已耗尽', mainCanvasSize.scale(.5), 26, colors.red, 5, colors.dark);
}
