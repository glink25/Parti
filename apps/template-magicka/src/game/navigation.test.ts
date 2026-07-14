import { describe,expect,it } from 'vitest';
import { generateMap } from './map';
import { steerToward,steeringTimedOut } from './navigation';

describe('local spring steering',()=>{
 it('keeps direct movement when unobstructed',()=>{const map=generateMap(22),from=map.spawn,target={x:from.x+200,y:from.y},result=steerToward(map,from,target,20,null);expect(result.position.x).toBeGreaterThan(from.x);expect(result.blocked).toBe(false);});
 it('slides around a local L-shaped corner instead of stopping',()=>{const map=generateMap(31),target={x:150,y:50},canOccupy=(p:{x:number;y:number})=>(p.x>=30&&p.x<=70&&p.y>=30&&p.y<=170)||(p.x>=30&&p.x<=170&&p.y>=30&&p.y<=70);let position={x:50,y:150},heading:number|null=null,moved=0,deflected=0;for(let i=0;i<100&&Math.hypot(position.x-target.x,position.y-target.y)>12;i++){const result=steerToward(map,position,target,8,heading,canOccupy);position=result.position;heading=result.heading;if(result.moved)moved++;if(result.blocked)deflected++;}expect(moved).toBeGreaterThan(10);expect(deflected).toBeGreaterThan(0);expect(Math.hypot(position.x-target.x,position.y-target.y)).toBeLessThan(24);});
 it('respects an additional sealed-room occupancy constraint',()=>{const map=generateMap(8),room=map.rooms[0]!,from=map.spawn,target={x:room.x+room.width+300,y:from.y},canOccupy=(p:{x:number;y:number})=>p.x>=room.x+24&&p.x<=room.x+room.width-24&&p.y>=room.y+24&&p.y<=room.y+room.height-24;let position=from,heading:number|null=null;for(let i=0;i<200;i++){const result=steerToward(map,position,target,16,heading,canOccupy);position=result.position;heading=result.heading;}expect(position.x).toBeLessThanOrEqual(room.x+room.width-24);});
 it('reports a hard stall only after the configured grace period',()=>{expect(steeringTimedOut(1000,2499)).toBe(false);expect(steeringTimedOut(1000,2500)).toBe(true);});
});
