import { cellKey, getMap, isSolid, MAP_HEIGHT, MAP_WIDTH } from './maps';
import type { BombState, Direction, GameState, PlayerState, PowerupState, PowerupType } from './types';

export const MATCH_MS = 240_000;
export const OVERTIME_MS = 30_000;
export const RESPAWN_MS = 2_000;
export const INVULNERABLE_MS = 2_000;
export const NORMAL_BOMB_FUSE_MS = 2_500;
export const REMOTE_BOMB_FUSE_MS = 5_000;
export const BASE_FLAME = 1;
export const BASE_CAPACITY = 1;
export const BASE_SPEED = 1;
export const MAX_FLAME = 4;
export const MAX_CAPACITY = 3;
export const MAX_SPEED = 3;
export const POWERUP_DROP_CHANCE = .3;
export const KICKED_BOMB_STEP_MS = 100;

export function playerSpawn(state: GameState, player: PlayerState) {
  const map = getMap(state.mapId);
  return map.spawns[player.spawnIndex % map.spawns.length];
}

export function moveDelayFor(player: PlayerState) {
  if (!player.bot) return Math.max(100, 260-player.speed*40);
  const base = player.difficulty==='easy' ? 420 : player.difficulty==='hard' ? 280 : 340;
  const minimum = player.difficulty==='easy' ? 320 : player.difficulty==='hard' ? 210 : 260;
  return Math.max(minimum, base-(player.speed-1)*25);
}

export function canMove(state: GameState, player: PlayerState, x: number, y: number) {
  return !isSolid(getMap(state.mapId), x, y, state.destroyed) && !state.bombs.some(b => b.x === x && b.y === y && !(player.x === x && player.y === y));
}

export function canBombMoveTo(state: GameState, bomb: BombState, x: number, y: number) {
  return !isSolid(getMap(state.mapId),x,y,state.destroyed) && !state.bombs.some(other=>other.id!==bomb.id&&other.x===x&&other.y===y);
}

export function movePlayer(state:GameState,player:PlayerState,direction:Direction,now:number) {
  const x=player.x+direction.dx,y=player.y+direction.dy;
  if(canMove(state,player,x,y)){player.x=x;player.y=y;return true;}
  if(!player.kick)return false;
  const bomb=state.bombs.find(candidate=>candidate.x===x&&candidate.y===y);
  if(!bomb||!canBombMoveTo(state,bomb,x+direction.dx,y+direction.dy))return false;
  bomb.x+=direction.dx;bomb.y+=direction.dy;bomb.motion={...direction};bomb.nextMoveAt=now+KICKED_BOMB_STEP_MS;
  player.x=x;player.y=y;return true;
}

export function blastCells(state: GameState, bomb: BombState) {
  const map = getMap(state.mapId);
  const result = [{x:bomb.x,y:bomb.y}];
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    for (let n=1;n<=bomb.flame;n++) {
      const x=bomb.x+dx*n, y=bomb.y+dy*n;
      const tile=map.rows[y]?.[x] ?? '#';
      if (tile==='#') break;
      result.push({x,y});
      if (tile==='+' && !state.destroyed.includes(cellKey(x,y))) break;
    }
  }
  return result;
}

export function leaders(state: GameState) {
  const active=Object.values(state.players).filter(p=>!p.waiting);
  const high=Math.max(0,...active.map(p=>p.score));
  return active.filter(p=>p.score===high).map(p=>p.id);
}

export function applyPowerup(player: PlayerState, type: PowerupType) {
  if(type==='flame') player.flame=Math.min(MAX_FLAME,player.flame+1);
  if(type==='capacity') player.capacity=Math.min(MAX_CAPACITY,player.capacity+1);
  if(type==='speed') player.speed=Math.min(MAX_SPEED,player.speed+1);
  if(type==='kick') player.kick=true;
  if(type==='remote') player.remote=true;
}

export function resetPlayerAbilities(player: PlayerState) {
  player.flame=BASE_FLAME;
  player.capacity=BASE_CAPACITY;
  player.speed=BASE_SPEED;
  player.kick=false;
  player.remote=false;
}

export function bombFuseFor(remote: boolean) {
  return remote ? REMOTE_BOMB_FUSE_MS : NORMAL_BOMB_FUSE_MS;
}

export function powerupDropForRoll(roll: number): PowerupType | null {
  if (roll < 0 || roll >= POWERUP_DROP_CHANCE) return null;
  const weighted=roll/POWERUP_DROP_CHANCE;
  if(weighted<.35) return 'flame';
  if(weighted<.65) return 'capacity';
  if(weighted<.85) return 'speed';
  if(weighted<.95) return 'kick';
  return 'remote';
}

export function deterministicDropRoll(x:number,y:number,tick:number) {
  const mixed=Math.imul(x+11,73856093)^Math.imul(y+17,19349663)^Math.imul(tick+23,83492791);
  return (mixed>>>0)/0x1_0000_0000;
}

export function removePowerupsInCells(powerups: PowerupState[], cells: Array<{x:number;y:number}>) {
  const keys=new Set(cells.map(cell=>cellKey(cell.x,cell.y)));
  return powerups.filter(item=>!keys.has(cellKey(item.x,item.y)));
}

export function chooseBotDirection(state: GameState, bot: PlayerState) {
  const choices = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}] as const;
  const dangerous=(x:number,y:number)=>state.flames.some(f=>f.cells.some(c=>c.x===x&&c.y===y)) || state.bombs.some(b=>Math.abs(b.x-x)+Math.abs(b.y-y)<=b.flame);
  const safe=choices.filter(d=>canMove(state,bot,bot.x+d.dx,bot.y+d.dy)&&!dangerous(bot.x+d.dx,bot.y+d.dy));
  const pool=safe.length?safe:choices.filter(d=>canMove(state,bot,bot.x+d.dx,bot.y+d.dy));
  return pool[(state.tick+bot.color*3)%Math.max(1,pool.length)] ?? {dx:0 as const,dy:0 as const};
}

export function validateMaps() {
  return ['garden-cross','garden-court','frost-bridge','frost-vault','volcano-core','volcano-rift','neon-grid','neon-loop'].every(id=>{
    const map=getMap(id);
    const validBoundary=map.rows[0]?.split('').every(tile=>tile==='#')&&map.rows[MAP_HEIGHT-1]?.split('').every(tile=>tile==='#')&&map.rows.every(row=>row[0]==='#'&&row[MAP_WIDTH-1]==='#');
    const safeSpawn=(spawn:{x:number;y:number})=>!isSolid(map,spawn.x,spawn.y,[])&&[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>!isSolid(map,spawn.x+dx,spawn.y+dy,[])).length>=2;
    return map.rows.length===MAP_HEIGHT&&map.rows.every(r=>r.length===MAP_WIDTH)&&validBoundary&&map.spawns.length===4&&map.spawns.every(safeSpawn);
  });
}
