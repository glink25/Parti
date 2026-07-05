import type {Element,ScrollItem} from './contracts';
import {createRng} from './map';

export type ScrollDefinition={spellId:string;name:string;pattern:Element[];cooldownMs:number;price:number;weight:number;description:string};
export const SCROLLS:readonly ScrollDefinition[]=[
 {spellId:'scroll-supernova',name:'超新星爆发',pattern:['lightning','life','shield','fire'],cooldownMs:20000,price:110,weight:.8,description:'当前房间所有存活实体损失50%当前生命'},
 {spellId:'scroll-equilibrium',name:'均衡术',pattern:['rock','shield','ice','life'],cooldownMs:20000,price:100,weight:1,description:'当前房间所有存活实体变为50%最大生命'},
 {spellId:'scroll-annihilation',name:'湮灭术',pattern:['rock','ice','life'],cooldownMs:20000,price:120,weight:.9,description:'唯一目标损失99%当前生命，Boss为50%'}
];
export type ScrollSource='merchant'|'elite'|'boss'|'chest'|'cursed-chest';
export const SCROLL_SOURCE_CHANCE:Record<ScrollSource,number>={merchant:.3,elite:.35,boss:1,chest:.02,'cursed-chest':.06};
export function scrollDefinition(spellId:string){return SCROLLS.find(v=>v.spellId===spellId);}
export function generateScroll(seed:number,sourceId:string,source:ScrollSource):ScrollItem|null{
 const random=createRng((seed^hash(`${source}:${sourceId}`))>>>0);if(random()>=SCROLL_SOURCE_CHANCE[source])return null;
 const total=SCROLLS.reduce((n,v)=>n+v.weight,0);let roll=random()*total,definition=SCROLLS[0]!;for(const candidate of SCROLLS){roll-=candidate.weight;if(roll<=0){definition=candidate;break;}}
 return{id:`scroll:${definition.spellId}:${seed.toString(36)}:${Math.abs(hash(sourceId)).toString(36)}`,kind:'scroll',name:definition.name,spellId:definition.spellId,cooldownMs:definition.cooldownMs,description:definition.description};
}
export function isScroll(item:unknown):item is ScrollItem{return Boolean(item&&typeof item==='object'&&(item as ScrollItem).kind==='scroll');}
function hash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h|0;}
