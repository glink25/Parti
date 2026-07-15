import { describe, expect, it } from 'vitest';
import type { Card } from '../../game/types';
import { analyzeGandengyan, canBeatGandengyan, enumerateGandengyan } from './gandengyan';
const c=(rank:number,id=String(rank),suit:Card['suit']='spades'):Card=>({id,suit,rank,label:String(rank)});
describe('gandengyan rules',()=>{
  it('rejects a lone joker and accepts it as a wildcard',()=>{expect(analyzeGandengyan([c(16,'j','joker')])).toBeNull();expect(analyzeGandengyan([c(7),c(16,'j','joker')])?.type).toBe('pair')});
  it('only accepts the immediate next rank for normal plays',()=>{const seven=analyzeGandengyan([c(7)])!,eight=analyzeGandengyan([c(8)])!,nine=analyzeGandengyan([c(9)])!;expect(canBeatGandengyan(eight,seven)).toBe(true);expect(canBeatGandengyan(nine,seven)).toBe(false)});
  it('allows 2 to follow ace and bombs to override',()=>{const ace=analyzeGandengyan([c(14)])!,two=analyzeGandengyan([c(15)])!,bomb=analyzeGandengyan([c(3,'a'),c(3,'b'),c(3,'c'),c(3,'d')])!;expect(canBeatGandengyan(two,ace)).toBe(true);expect(canBeatGandengyan(bomb,ace)).toBe(true)});
  it('AI only returns legal candidates',()=>{const previous=analyzeGandengyan([c(6)])!,moves=enumerateGandengyan([c(7),c(9),c(16,'j','joker')],previous);expect(moves.length).toBeGreaterThan(0);expect(moves.every(move=>canBeatGandengyan(analyzeGandengyan(move)!,previous))).toBe(true)});
});
