import type { EquipmentItem,EquipmentSlot,EquipmentStats,MapManifest,MerchantState,PlayerEquipment } from './contracts';
import { createRng } from './map';

type Prototype={id:string;name:string;slot:EquipmentSlot;base:Partial<EquipmentStats>};
const PROTOTYPES:readonly Prototype[]=[
 {id:'ember-staff',name:'余烬法杖',slot:'staff',base:{spellPower:.12}},{id:'swift-staff',name:'迅捷法杖',slot:'staff',base:{castSpeed:.12}},{id:'balanced-staff',name:'均衡法杖',slot:'staff',base:{spellPower:.07,castSpeed:.07}},
 {id:'stone-robe',name:'磐石法袍',slot:'robe',base:{damageReduction:.12}},{id:'wind-robe',name:'逐风法袍',slot:'robe',base:{moveSpeed:.1}},{id:'warded-robe',name:'守御法袍',slot:'robe',base:{damageReduction:.07,moveSpeed:.05}},
 {id:'power-ring',name:'聚能戒指',slot:'ring',base:{spellPower:.08}},{id:'tempo-ring',name:'节律戒指',slot:'ring',base:{castSpeed:.08}},{id:'traveler-ring',name:'旅者戒指',slot:'ring',base:{moveSpeed:.08}}
];
const AFFIXES=[{name:'强能',stat:'spellPower' as const,min:.04,max:.1},{name:'咏唱',stat:'castSpeed' as const,min:.04,max:.1},{name:'坚韧',stat:'damageReduction' as const,min:.04,max:.08},{name:'轻盈',stat:'moveSpeed' as const,min:.04,max:.09}];
const ZERO:EquipmentStats={spellPower:0,castSpeed:0,damageReduction:0,moveSpeed:0};

export function generateEquipment(seed:number,index:number):EquipmentItem{const random=createRng((seed^Math.imul(index+1,0x9e3779b1))>>>0),prototype=PROTOTYPES[Math.floor(random()*PROTOTYPES.length)]!,rarityRoll=random(),rarity=rarityRoll>.86?'rare':rarityRoll>.5?'uncommon':'common',affixCount=rarity==='rare'?2:rarity==='uncommon'?1:0,stats={...ZERO,...prototype.base},affixes:string[]=[];for(const affix of shuffle([...AFFIXES],random).slice(0,affixCount)){const value=affix.min+(affix.max-affix.min)*random();stats[affix.stat]+=value;affixes.push(`${affix.name} +${Math.round(value*100)}%`);}return{id:`item:${seed.toString(36)}:${index}`,prototypeId:prototype.id,name:prototype.name,slot:prototype.slot,rarity,stats:roundStats(stats),affixes};}
export function equipmentBonuses(equipment:PlayerEquipment){const result={...ZERO};for(const item of Object.values(equipment))if(item)for(const key of Object.keys(result)as Array<keyof EquipmentStats>)result[key]+=item.stats[key];return roundStats(result);}
export function createMerchant(map:MapManifest,stageIndex:number):MerchantState{const room=map.rooms.find(r=>r.id!=='room-0'&&r.templateKind==='standard')??map.rooms[1]!,stock=[0,1,2].map(i=>{const item=generateEquipment(map.seed^0x6d657263,stageIndex*10+i);return{item,price:item.rarity==='rare'?95:item.rarity==='uncommon'?60:35};});return{id:`merchant:${stageIndex}`,roomId:room.id,x:room.x+room.width/2,y:room.y+room.height/2,stock};}
export function canEquip(inventory:readonly EquipmentItem[],itemId:string){return inventory.some(item=>item.id===itemId);}
function roundStats(stats:EquipmentStats){return Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,Math.round(v*1000)/1000])) as EquipmentStats;}
function shuffle<T>(values:T[],random:()=>number){for(let i=values.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[values[i],values[j]]=[values[j]!,values[i]!];}return values;}
