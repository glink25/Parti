import { describe, expect, it } from 'vitest';
import type { Card } from '../../game/types';
import { chameleonCardPoints, chooseChameleon, isChameleonLegal, validateChoice } from './chameleon';
const c=(rank:number,suit:Card['suit']='spades',id=`${suit}:${rank}`):Card=>({id,suit,rank,label:String(rank)});
describe('chameleon rules',()=>{
  it('accepts matching suit, matching rank, or J',()=>{expect(isChameleonLegal(c(4,'hearts'),'hearts',8)).toBe(true);expect(isChameleonLegal(c(8,'clubs'),'hearts',8)).toBe(true);expect(isChameleonLegal(c(11,'spades'),'hearts',8)).toBe(true);expect(isChameleonLegal(c(5,'clubs'),'hearts',8)).toBe(false)});
  it('requires a valid suit and rank choice',()=>{expect(validateChoice({suit:'clubs',rank:12})).toEqual({suit:'clubs',rank:12});expect(validateChoice({suit:'joker',rank:12})).toBeNull();expect(validateChoice({suit:'clubs',rank:14})).toBeNull()});
  it('scores remaining cards using the room rules',()=>{expect([c(1),c(8),c(11),c(13)].reduce((sum,card)=>sum+chameleonCardPoints(card),0)).toBe(39)});
  it('AI saves J while a normal legal card exists',()=>{const move=chooseChameleon([c(11),c(6,'hearts')],'hearts',4);expect(move?.card.rank).toBe(6)});
});
