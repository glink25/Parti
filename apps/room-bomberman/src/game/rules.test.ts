import { describe, expect, it } from 'vitest';
import { MAPS } from './maps';
import { applyPowerup, BASE_CAPACITY, BASE_FLAME, BASE_SPEED, blastCells, bombFuseFor, canBombMoveTo, canMove, deterministicDropRoll, leaders, MAX_CAPACITY, MAX_FLAME, MAX_SPEED, moveDelayFor, NORMAL_BOMB_FUSE_MS, playerSpawn, powerupDropForRoll, REMOTE_BOMB_FUSE_MS, removePowerupsInCells, resetPlayerAbilities, validateMaps } from './rules';
import type { GameState, PlayerState } from './types';

const player=(id:string,x=1,y=1):PlayerState=>({id,name:id,bot:false,ready:true,connected:true,waiting:false,x,y,input:{dx:0,dy:0},alive:true,score:0,deaths:0,flame:BASE_FLAME,capacity:BASE_CAPACITY,speed:BASE_SPEED,kick:false,remote:false,respawnAt:0,invulnerableUntil:0,nextMoveAt:0,color:0,spawnIndex:0});
const state=():GameState=>({schema:'bomberman-v1',phase:'playing',hostId:'p1',mapId:MAPS[0].id,players:{p1:player('p1'),p2:player('p2',11,9)},bombs:[],flames:[],powerups:[],destroyed:[],startedAt:0,endsAt:0,overtimeEndsAt:0,overtimeLeaders:[],winners:[],tick:0});

describe('arena maps',()=>{
  it('ships eight valid maps with four safe spawns',()=>{expect(MAPS).toHaveLength(8);expect(validateMaps()).toBe(true);expect(MAPS.every(map=>map.spawns.length===4)).toBe(true)});
  it('always returns the player fixed spawn, even when it is dangerous',()=>{const game=state(),p=game.players.p2;p.spawnIndex=3;game.bombs.push({id:'b',ownerId:'p1',x:11,y:9,flame:2,explodeAt:0,remote:false,motion:{dx:0,dy:0},nextMoveAt:0});expect(playerSpawn(game,p)).toEqual({x:11,y:9})});
});

describe('pure game rules',()=>{
  it('stops a blast at solid walls and destructible bricks',()=>{const game=state();const cells=blastCells(game,{id:'b',ownerId:'p1',x:1,y:1,flame:6,explodeAt:0,remote:false,motion:{dx:0,dy:0},nextMoveAt:0});expect(cells).toContainEqual({x:1,y:2});expect(cells).not.toContainEqual({x:1,y:3})});
  it('blocks walls and active bombs',()=>{const game=state();expect(canMove(game,game.players.p1,0,1)).toBe(false);game.bombs.push({id:'b',ownerId:'p2',x:2,y:1,flame:2,explodeAt:0,remote:false,motion:{dx:0,dy:0},nextMoveAt:0});expect(canMove(game,game.players.p1,2,1)).toBe(false)});
  it('lets kicked bombs cross floor but stops them at walls, bricks, and other bombs',()=>{const game=state(),bomb={id:'moving',ownerId:'p1',x:1,y:1,flame:1,explodeAt:9999,remote:false,motion:{dx:1 as const,dy:0 as const},nextMoveAt:0};game.bombs.push(bomb);expect(canBombMoveTo(game,bomb,2,1)).toBe(true);expect(canBombMoveTo(game,bomb,0,1)).toBe(false);expect(canBombMoveTo(game,bomb,4,1)).toBe(false);game.bombs.push({...bomb,id:'blocker',x:2,y:1});expect(canBombMoveTo(game,bomb,2,1)).toBe(false)});
  it('applies and caps all five powerups',()=>{const p=player('p');for(let i=0;i<10;i++){applyPowerup(p,'flame');applyPowerup(p,'capacity');applyPowerup(p,'speed')}applyPowerup(p,'kick');applyPowerup(p,'remote');expect(p).toMatchObject({flame:MAX_FLAME,capacity:MAX_CAPACITY,speed:MAX_SPEED,kick:true,remote:true})});
  it('fully resets abilities without resetting score',()=>{const p=player('p');Object.assign(p,{flame:4,capacity:3,speed:3,kick:true,remote:true,score:7});resetPlayerAbilities(p);expect(p).toMatchObject({flame:1,capacity:1,speed:1,kick:false,remote:false,score:7})});
  it('uses distinct normal and remote fuse limits',()=>{expect(bombFuseFor(false)).toBe(NORMAL_BOMB_FUSE_MS);expect(bombFuseFor(true)).toBe(REMOTE_BOMB_FUSE_MS);expect(REMOTE_BOMB_FUSE_MS).toBe(5000)});
  it('maps the 30 percent drop window to weighted item boundaries',()=>{expect(powerupDropForRoll(0)).toBe('flame');expect(powerupDropForRoll(.1049)).toBe('flame');expect(powerupDropForRoll(.105)).toBe('capacity');expect(powerupDropForRoll(.195)).toBe('speed');expect(powerupDropForRoll(.255)).toBe('kick');expect(powerupDropForRoll(.285)).toBe('remote');expect(powerupDropForRoll(.3)).toBeNull()});
  it('produces deterministic drop rolls in the unit interval',()=>{const first=deterministicDropRoll(3,5,7);expect(first).toBe(deterministicDropRoll(3,5,7));expect(first).toBeGreaterThanOrEqual(0);expect(first).toBeLessThan(1)});
  it('removes exposed items before a newly revealed item is appended',()=>{const cells=[{x:2,y:3}],existing=[{id:'old',type:'speed' as const,x:2,y:3},{id:'safe',type:'flame' as const,x:4,y:3}];const survivors=removePowerupsInCells(existing,cells);expect([...survivors,{id:'new',type:'remote' as const,x:2,y:3}].map(item=>item.id)).toEqual(['safe','new'])});
  it('returns every tied score leader',()=>{const game=state();game.players.p1.score=4;game.players.p2.score=4;expect(leaders(game)).toEqual(['p1','p2'])});
  it('paces bots slower than humans and caps speed upgrades',()=>{const human=player('human'),bot={...player('bot'),bot:true,difficulty:'normal' as const};expect(moveDelayFor(bot)).toBeGreaterThan(moveDelayFor(human));bot.speed=4;expect(moveDelayFor(bot)).toBe(265)});
});
