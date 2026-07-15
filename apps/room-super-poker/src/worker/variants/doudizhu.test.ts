import { describe, expect, it } from 'vitest';
import type { Card } from '../../game/types';
import { analyzeDoudizhu, canBeatDoudizhu, enumerateDoudizhu } from './doudizhu';
const cards=(ranks:number[]):Card[]=>ranks.map((rank,index)=>({id:String(index),suit:rank>=16?'joker':'spades',rank,label:String(rank)}));
describe('doudizhu rules',()=>{
  it('recognizes the principal combinations',()=>{expect(analyzeDoudizhu(cards([3]))?.type).toBe('single');expect(analyzeDoudizhu(cards([4,4]))?.type).toBe('pair');expect(analyzeDoudizhu(cards([3,4,5,6,7]))?.type).toBe('straight');expect(analyzeDoudizhu(cards([16,17]))?.type).toBe('rocket')});
  it('requires matching shapes while bombs override',()=>{const pair=analyzeDoudizhu(cards([8,8]))!,higher=analyzeDoudizhu(cards([9,9]))!,single=analyzeDoudizhu(cards([10]))!,bomb=analyzeDoudizhu(cards([3,3,3,3]))!;expect(canBeatDoudizhu(higher,pair)).toBe(true);expect(canBeatDoudizhu(single,pair)).toBe(false);expect(canBeatDoudizhu(bomb,pair)).toBe(true)});
  it('AI candidates are legal and preserve bombs when a normal play exists',()=>{const hand=cards([3,4,7,7,7,7]);const previous=analyzeDoudizhu(cards([3]))!,moves=enumerateDoudizhu(hand,previous);expect(moves.length).toBeGreaterThan(0);expect(moves.every(move=>canBeatDoudizhu(analyzeDoudizhu(move)!,previous))).toBe(true);expect(analyzeDoudizhu(moves[0]!)?.type).toBe('single')});
});
