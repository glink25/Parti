import type { Card, PlayAnalysis } from '../../game/types';

type Pattern='single'|'pair'|'triple'|'straight'|'pair-straight'|'bomb';
export function analyzeGandengyan(cards:Card[]):PlayAnalysis|null{
  if(!cards.length)return null;const jokers=cards.filter(c=>c.suit==='joker').length,natural=cards.filter(c=>c.suit!=='joker');if(!natural.length)return null;
  const ranks=new Map<number,number>();for(const c of natural)ranks.set(c.rank,(ranks.get(c.rank)??0)+1);
  const distinct=[...ranks.keys()].sort((a,b)=>a-b),n=cards.length;
  if(distinct.length===1&&n<=4&&natural.length+jokers===n){const type:Pattern=n===1?'single':n===2?'pair':n===3?'triple':'bomb';return result(type,distinct[0]!,n)}
  if(n>=3&&distinct.every((r,i)=>i===0||r===distinct[i-1]!+1)&&distinct.at(-1)!<15&&natural.length+jokers===n&&n-distinct.length===jokers)return result('straight',distinct.at(-1)!,n,n);
  if(n>=4&&n%2===0&&distinct.every((r,i)=>i===0||r===distinct[i-1]!+1)&&distinct.at(-1)!<15&&[...ranks.values()].every(v=>v<=2)&&natural.length+jokers===n)return result('pair-straight',distinct.at(-1)!,n,n/2);
  return null;
}
export function canBeatGandengyan(candidate:PlayAnalysis,previous:PlayAnalysis|null){if(!previous)return true;if(candidate.type==='bomb')return previous.type!=='bomb'||candidate.rank>previous.rank;if(previous.type==='bomb'||candidate.type!==previous.type||candidate.length!==previous.length)return false;return candidate.rank===nextRank(previous.rank)}
export function enumerateGandengyan(hand:Card[],previous:PlayAnalysis|null):Card[][]{const out:Card[][]=[];for(let i=0;i<hand.length;i+=1){const one=[hand[i]!],a=analyzeGandengyan(one);if(a&&canBeatGandengyan(a,previous))out.push(one);for(let j=i+1;j<hand.length;j+=1){const two=[hand[i]!,hand[j]!],b=analyzeGandengyan(two);if(b&&canBeatGandengyan(b,previous))out.push(two)}}const groups=new Map<number,Card[]>();for(const c of hand)if(c.suit!=='joker')groups.set(c.rank,[...(groups.get(c.rank)??[]),c]);for(const cards of groups.values()){for(const n of [3,4])if(cards.length>=n){const play=cards.slice(0,n),a=analyzeGandengyan(play);if(a&&canBeatGandengyan(a,previous))out.push(play)}}return dedupe(out).sort((a,b)=>(analyzeGandengyan(a)!.type==='bomb'?1000:0)+analyzeGandengyan(a)!.rank-((analyzeGandengyan(b)!.type==='bomb'?1000:0)+analyzeGandengyan(b)!.rank))}
export function nextRank(rank:number){return rank===14?15:rank+1}
function result(type:Pattern,rank:number,length:number,chainLength?:number):PlayAnalysis{return{type,rank,length,chainLength,label:{single:'单张',pair:'对子',triple:'三张',straight:'顺子','pair-straight':'连对',bomb:'炸弹'}[type]}}
function dedupe(plays:Card[][]){const seen=new Set<string>();return plays.filter(p=>{const key=p.map(c=>c.id).sort().join();if(seen.has(key))return false;seen.add(key);return true})}
