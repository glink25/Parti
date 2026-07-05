import { describe,expect,it } from 'vitest';
import { applyBlackHolePull,beamTargets,blackHoleZone,coneContains,createPending,enemyCap,furthestReachable,rayToBoundary,turnToward,ZERO_CONTROL,applyControl } from './combat';
import type { AimState,EnemyState } from './contracts';
import { WORLD_WIDTH } from './contracts';
const enemy=(id:string,x:number,y:number):EnemyState=>({id,roomId:'room-1',kind:'chaser',x,y,hp:50,maxHp:50,radius:20,targetId:null,nextAttackAt:0,attack:null,statuses:[],controls:{...ZERO_CONTROL},flashUntil:0,revision:0});
describe('combat geometry',()=>{
 it('extends a beam to the world boundary',()=>expect(rayToBoundary({x:800,y:450},0)).toEqual({x:WORLD_WIDTH,y:450}));
 it('orders beam targets and respects pierce',()=>{const targets=beamTargets({x:0,y:100},0,10,[enemy('b',300,100),enemy('a',100,100)],0);expect(targets.map(v=>v.enemy.id)).toEqual(['a']);expect(beamTargets({x:0,y:100},0,10,[enemy('b',300,100),enemy('a',100,100)],1)).toHaveLength(2)});
 it('classifies black-hole zones and adds an inward velocity vector',()=>{const hole={x:0,y:0,radius:340,innerRadius:80,pullStrength:700};expect(blackHoleZone({x:50,y:0},hole)).toBe('inner');expect(blackHoleZone({x:200,y:0},hole)).toBe('outer');expect(blackHoleZone({x:400,y:0},hole)).toBe('outside');const still=applyBlackHolePull({vx:0,vy:0},{x:200,y:0},hole,.1),outward=applyBlackHolePull({vx:100,vy:0},{x:200,y:0},hole,.1),inward=applyBlackHolePull({vx:-100,vy:0},{x:200,y:0},hole,.1),inner=applyBlackHolePull({vx:0,vy:0},{x:50,y:0},hole,.1);expect(still.vx).toBeLessThan(0);expect(outward.vx).toBeLessThan(100);expect(inward.vx).toBeLessThan(-100);expect(inner.vx).toBeLessThan(still.vx);});
 it('stops at the furthest valid point',()=>expect(furthestReachable({x:0,y:0},{x:100,y:0},p=>p.x<55,5)).toEqual({x:50,y:0}));
 it('checks cone range and angle',()=>{expect(coneContains({x:0,y:0},0,200,Math.PI/6,{x:150,y:20},10)).toBe(true);expect(coneContains({x:0,y:0},0,200,Math.PI/6,{x:0,y:150},10)).toBe(false)});
 it('limits turn speed',()=>expect(turnToward(0,Math.PI,Math.PI/4)).toBeCloseTo(Math.PI/4));
});
describe('state helpers',()=>{
 it('schedules normal casts after release',()=>{const aim={plan:{castMs:500} as AimState['plan'],target:{x:10,y:10}} as AimState;expect(createPending('x',aim,1000).triggersAt).toBe(1500)});
 it('applies controls and caps enemies by player count',()=>{expect(applyControl({...ZERO_CONTROL},{kind:'stun',strength:1,durationMs:500},{x:1,y:0},100).stunnedUntil).toBe(600);expect([1,2,3,4].map(enemyCap)).toEqual([8,12,16,20])});
});
