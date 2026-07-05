import {describe,expect,it} from 'vitest';
import {formationPosition,orderedPlayerIds} from './formation';

describe('player formation',()=>{
 it('assigns four unique slots clockwise from the top',()=>{
  const center={x:500,y:400},positions=Array.from({length:4},(_,index)=>formationPosition(center,index,96));
  expect(positions).toEqual([{x:500,y:304},{x:596,y:400},{x:500,y:496},{x:404,y:400}]);
  expect(new Set(positions.map(p=>`${p.x}:${p.y}`)).size).toBe(4);
 });
 it('keeps surviving join order and appends a returning lobby player',()=>{
  expect(orderedPlayerIds(['a','b','c'],{a:{},c:{}})).toEqual(['a','c']);
  expect(orderedPlayerIds(['a','c','b'],{a:{},b:{},c:{}})).toEqual(['a','c','b']);
 });
 it('rejects slots beyond the four-player room limit',()=>{expect(()=>formationPosition({x:0,y:0},4,96)).toThrow(RangeError);});
});
