import { describe, expect, it } from 'vitest';
import { doudizhuPresentationMask } from './DoudizhuPresentation';
describe('Doudizhu presentation ownership',()=>{
  it('hides the authoritative center play while its flight owns the cards',()=>expect(doudizhuPresentationMask({id:'p',kind:'cardsPlayed',duration:500,progress:.5}).hiddenCenterPlay).toBe(true));
  it('releases ownership without an animation',()=>expect(doudizhuPresentationMask(null).hiddenCenterPlay).toBe(false));
});
