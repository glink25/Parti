import { describe, expect, it } from 'vitest';
import { createDeck, takeCards } from './cards';
import { VARIANTS } from './variants/registry';
describe('shared poker model',()=>{
  it('creates the required deck sizes with unique ids',()=>{const standard=createDeck(),doudizhu=createDeck({jokers:true,aceHigh:true}),double=createDeck({jokers:true,aceHigh:true,copies:2});expect(standard).toHaveLength(52);expect(doudizhu).toHaveLength(54);expect(double).toHaveLength(108);expect(new Set(double.map(c=>c.id)).size).toBe(108)});
  it('rejects duplicate and forged hand ids',()=>{const hand=createDeck().slice(0,3),id=hand[0]!.id;expect(takeCards(hand,[id,id])).toBeNull();expect(takeCards(hand,['missing'])).toBeNull()});
  it('declares the correct player limits',()=>{expect(VARIANTS.doudizhu.meta.minPlayers).toBe(3);expect(VARIANTS.doudizhu.meta.maxPlayers).toBe(3);expect(VARIANTS.gandengyan.meta.maxPlayers).toBe(6);expect(VARIANTS.chameleon.meta.maxPlayers).toBe(8)});
});
