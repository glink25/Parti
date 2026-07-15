import type { Card, PlayAnalysis } from '../../game/types';

const LABELS:Record<string,string>={single:'单张',pair:'对子',triple:'三张','triple-single':'三带一','triple-pair':'三带二',straight:'顺子','pair-straight':'连对',airplane:'飞机','airplane-singles':'飞机带单','airplane-pairs':'飞机带对','four-two-singles':'四带二','four-two-pairs':'四带两对',bomb:'炸弹',rocket:'火箭'};
type Group={rank:number;count:number};
export function analyzeDoudizhu(cards:Card[]):PlayAnalysis|null{
  if(!cards.length)return null;const groups=rankGroups(cards),counts=groups.map(g=>g.count).sort((a,b)=>b-a),ranks=groups.map(g=>g.rank).sort((a,b)=>a-b),n=cards.length;
  if(n===2&&ranks.includes(16)&&ranks.includes(17))return out('rocket',17,n);
  if(n===4&&groups.length===1)return out('bomb',groups[0]!.rank,n);
  if(n===1)return out('single',ranks[0]!,n);if(n===2&&groups.length===1)return out('pair',ranks[0]!,n);if(n===3&&groups.length===1)return out('triple',ranks[0]!,n);
  if(n===4&&counts[0]===3)return out('triple-single',rankOf(groups,3),n);if(n===5&&counts[0]===3&&counts[1]===2)return out('triple-pair',rankOf(groups,3),n);
  if(n>=5&&groups.every(g=>g.count===1)&&consecutive(ranks))return out('straight',ranks.at(-1)!,n,ranks.length);
  if(n>=6&&n%2===0&&groups.every(g=>g.count===2)&&consecutive(ranks))return out('pair-straight',ranks.at(-1)!,n,ranks.length);
  const triples=groups.filter(g=>g.count===3).map(g=>g.rank).sort((a,b)=>a-b);
  for(const chain of slices(triples)){const length=chain.length,rank=chain.at(-1)!;if(n===length*3)return out('airplane',rank,n,length);if(n===length*4&&nonChain(groups,chain)===length)return out('airplane-singles',rank,n,length);if(n===length*5&&pairAttachments(groups,chain)===length)return out('airplane-pairs',rank,n,length)}
  if(n===6&&counts[0]===4)return out('four-two-singles',rankOf(groups,4),n);if(n===8&&counts[0]===4&&groups.filter(g=>g.count===2).length===2)return out('four-two-pairs',rankOf(groups,4),n);
  return null;
}
export function canBeatDoudizhu(candidate:PlayAnalysis,previous:PlayAnalysis|null){if(!previous)return true;if(candidate.type==='rocket')return previous.type!=='rocket';if(previous.type==='rocket')return false;if(candidate.type==='bomb'&&previous.type!=='bomb')return true;if(previous.type==='bomb'&&candidate.type!=='bomb')return false;return candidate.type===previous.type&&candidate.length===previous.length&&(candidate.chainLength??0)===(previous.chainLength??0)&&candidate.rank>previous.rank}
export function enumerateDoudizhu(hand:Card[],previous:PlayAnalysis|null):Card[][]{const plays:Card[][]=[];const add=(cards:Card[])=>{const analysis=analyzeDoudizhu(cards);if(analysis&&canBeatDoudizhu(analysis,previous))plays.push(cards)};for(const card of hand)add([card]);const groups=new Map<number,Card[]>();for(const card of hand)groups.set(card.rank,[...(groups.get(card.rank)??[]),card]);for(const cards of groups.values()){if(cards.length>=2)add(cards.slice(0,2));if(cards.length>=3)add(cards.slice(0,3));if(cards.length>=4)add(cards.slice(0,4))}const small=hand.find(c=>c.rank===16),big=hand.find(c=>c.rank===17);if(small&&big)add([small,big]);return plays.sort((a,b)=>score(a)-score(b))}
export const doudizhuScore=(cards:Card[])=>score(cards);
function score(cards:Card[]){const a=analyzeDoudizhu(cards)!;return (a.type==='rocket'?10000:a.type==='bomb'?5000:0)+a.rank+cards.length*.01}
function out(type:string,rank:number,length:number,chainLength?:number):PlayAnalysis{return{type,rank,length,chainLength,label:LABELS[type]!}}
function rankGroups(cards:Card[]):Group[]{const m=new Map<number,number>();for(const c of cards)m.set(c.rank,(m.get(c.rank)??0)+1);return[...m].map(([rank,count])=>({rank,count})).sort((a,b)=>b.count-a.count||b.rank-a.rank)}
function rankOf(groups:Group[],count:number){return groups.find(g=>g.count===count)!.rank}
function consecutive(ranks:number[]){return !ranks.some(r=>r>=15)&&ranks.every((r,i)=>i===0||r===ranks[i-1]!+1)}
function slices(ranks:number[]){const valid=ranks.filter(r=>r<15).sort((a,b)=>a-b),result:number[][]=[];let start=0;for(let i=1;i<=valid.length;i+=1)if(i===valid.length||valid[i]!==valid[i-1]!+1){const run=valid.slice(start,i);for(let len=run.length;len>=2;len-=1)for(let off=0;off+len<=run.length;off+=1)result.push(run.slice(off,off+len));start=i}return result}
function nonChain(groups:Group[],chain:number[]){const set=new Set(chain);return groups.reduce((sum,g)=>sum+(set.has(g.rank)?Math.max(0,g.count-3):g.count),0)}
function pairAttachments(groups:Group[],chain:number[]){const set=new Set(chain);return groups.filter(g=>!set.has(g.rank)&&g.count===2).length}
