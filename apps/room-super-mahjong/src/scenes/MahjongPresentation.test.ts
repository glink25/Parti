import { describe, expect, it } from 'vitest';
import { findAddedTile, mahjongPresentationMask, settlementScores } from './MahjongPresentation';

describe('Mahjong presentation ownership', () => {
  const one = { id: '1', kind: 'm1' as const }, two = { id: '2', kind: 'p2' as const };
  it('finds exactly one privately drawn tile without replaying duplicate state', () => {
    expect(findAddedTile([one], [one, two])).toEqual(two);
    expect(findAddedTile([one, two], [one, two])).toBeNull();
    expect(findAddedTile([], [one, two])).toBeNull();
  });
  it('gives an active draw exclusive ownership of the new hand tile', () => {
    const mask = mahjongPresentationMask({ id:'draw',kind:'draw',duration:1200,progress:.5,actorSeat:0,drawnTile:two },0);
    expect(mask.hiddenHandTileIds.has('2')).toBe(true);
    expect(mahjongPresentationMask({ id:'draw',kind:'draw',duration:1200,progress:.5,actorSeat:1,drawnTile:undefined },0).hiddenHandTileIds.size).toBe(0);
  });
  it('derives before, round and final totals', () => {
    expect(settlementScores([18,-3], { draw:false,winners:[],deltas:[8,-8],message:'' })).toEqual([
      {seat:0,before:10,delta:8,total:18},{seat:1,before:5,delta:-8,total:-3},
    ]);
    expect(settlementScores([20,0],{draw:false,winners:[],deltas:[8,-8],message:''},[7,13])).toEqual([{seat:0,before:7,delta:13,total:20},{seat:1,before:13,delta:-13,total:0}]);
  });
});
