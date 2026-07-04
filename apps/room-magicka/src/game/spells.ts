import type { Element, SpellEffect, SpellPlan, SpellPresentation, SpellRecipe, StaffModifier, StatusInstance, StatusKind } from './contracts';

const damage=(element:Element,amount:number):SpellEffect=>({type:'damage',element,amount});
const status=(kind:StatusKind,intensity=1,durationMs=4000):SpellEffect=>({type:'status',status:kind,intensity,durationMs});
const control=(kind:'knockback'|'knockup'|'slow'|'stun',strength:number,durationMs:number):SpellEffect=>({type:'control',control:{kind,strength,durationMs}});

export const RECIPES:readonly SpellRecipe[]=[
 {id:'flame-beam',name:'生命烈焰',pattern:['fire','life'],delivery:'beam',castMs:240,channel:true,tickMs:140,recoveryMs:220,range:1600,radius:18,effects:[damage('fire',9),status('burning',1,3500)]},
 {id:'meteor',name:'天降陨石',pattern:['fire','rock','rock','fire'],delivery:'targeted',castMs:850,range:900,radius:145,effects:[damage('fire',75),damage('rock',45),status('burning',2,5000),control('knockup',520,700)]},
 {id:'rain',name:'全场降雨',pattern:['fire','water','water','fire'],delivery:'global',castMs:900,range:0,radius:0,effects:[{type:'environment',kind:'rain',durationMs:12000}]},
 {id:'freeze-stream',name:'冻结水流',pattern:['water','ice'],delivery:'beam',castMs:220,channel:true,tickMs:130,recoveryMs:200,range:1600,radius:18,effects:[damage('ice',7),status('wet'),status('chilled',1,1800),control('slow',.55,1200)]},
 {id:'steam-cloud',name:'蒸汽云',pattern:['fire','water'],delivery:'area',castMs:320,range:650,radius:120,effects:[damage('fire',18),{type:'environment',kind:'steam',durationMs:5500,radius:120}]},
 {id:'lava-shot',name:'熔岩弹',pattern:['rock','fire'],delivery:'projectile',castMs:260,projectileSpeed:520,range:720,radius:48,effects:[damage('rock',34),damage('fire',26),status('burning'),control('knockback',300,350)]},
 {id:'healing-pool',name:'生命之泉',pattern:['water','life'],delivery:'area',castMs:400,range:600,radius:120,effects:[{type:'heal',amount:35},status('wet')]},
 {id:'shatter-shot',name:'碎冰岩弹',pattern:['rock','ice'],delivery:'projectile',castMs:260,projectileSpeed:600,range:700,radius:42,effects:[damage('rock',40),damage('ice',18),status('chilled'),control('knockup',440,650)]},
 {id:'storm-chain',name:'导电水链',pattern:['water','lightning'],delivery:'targeted',castMs:220,range:700,radius:150,effects:[damage('lightning',42),status('wet'),status('shocked',1,1200),control('stun',1,700)]},
 {id:'flamethrower',name:'烈焰喷射',pattern:['fire','fire'],delivery:'cone',castMs:120,range:390,radius:90,coneAngle:1.05,effects:[damage('fire',40),status('burning',2)]},
 {id:'stone-ward',name:'岩石护盾',pattern:['shield','rock'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',2,9000)]},
 {id:'fire-ward',name:'火焰护盾',pattern:['shield','fire'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000),status('fire-ward',1,9000)]},
 {id:'frost-ward',name:'寒冰护盾',pattern:['shield','ice'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000),status('frost-ward',1,9000)]},
 {id:'grounding-ward',name:'接地护盾',pattern:['shield','lightning'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000)]},
 {id:'water-ward',name:'流水护盾',pattern:['shield','water'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000),status('water-ward',1,9000)]},
 {id:'ice-wall',name:'冰墙',pattern:['ice','shield','shield','ice'],delivery:'area',castMs:500,range:620,radius:110,effects:[{type:'environment',kind:'ice-wall',durationMs:6500,radius:110}],traits:['ice-wall']},
 {id:'storm-field',name:'雷暴领域',pattern:['lightning','water','lightning','shield'],delivery:'area',castMs:520,range:650,radius:155,effects:[{type:'environment',kind:'storm-field',durationMs:6000,radius:155}],traits:['storm-field']},
 {id:'chain-heal',name:'连锁治疗',pattern:['life','lightning','life'],delivery:'targeted',castMs:260,range:620,radius:115,effects:[{type:'heal',amount:32}],traits:['chain-heal']},
 {id:'gravity-well',name:'重力井',pattern:['rock','shield','lightning','rock'],delivery:'area',castMs:600,range:620,radius:170,effects:[{type:'environment',kind:'gravity-well',durationMs:4200,radius:170}],traits:['gravity-well']},
 {id:'fire-ring',name:'火焰环',pattern:['fire','shield','fire'],delivery:'self',castMs:300,range:0,radius:135,effects:[{type:'environment',kind:'fire-ring',durationMs:5000,radius:135}],traits:['fire-ring']},
 {id:'ice-lance',name:'寒冰长矛',pattern:['ice','ice','rock'],delivery:'projectile',castMs:280,projectileSpeed:980,range:980,radius:24,pierce:4,effects:[damage('ice',52),status('chilled',2,2600)],traits:['ice-lance']},
 {id:'tidal-wave',name:'潮汐冲击',pattern:['water','rock','water'],delivery:'cone',castMs:360,range:520,radius:110,coneAngle:1.25,effects:[damage('water',30),status('wet'),control('knockback',520,500)],traits:['tidal-wave','water-pool']},
 {id:'life-barrier',name:'生命屏障',pattern:['life','shield','life','shield'],delivery:'area',castMs:520,range:600,radius:145,effects:[{type:'environment',kind:'life-barrier',durationMs:6500,radius:145}],traits:['life-barrier']}
];

const bases:Record<Element,Omit<SpellPlan,'id'|'elements'>>={
 rock:{name:'岩弹',delivery:'projectile',castMs:220,channel:false,range:680,radius:34,effects:[damage('rock',38),control('knockback',360,400)],pierce:0,tickMs:150,recoveryMs:180,projectileSpeed:650,coneAngle:.9,traits:[]},
 fire:{name:'火焰',delivery:'cone',castMs:100,channel:false,range:300,radius:28,effects:[damage('fire',32),status('burning')],pierce:0,tickMs:150,recoveryMs:140,projectileSpeed:600,coneAngle:1.05,traits:[]},
 ice:{name:'冰弹',delivery:'projectile',castMs:160,channel:false,range:650,radius:30,effects:[damage('ice',28),status('chilled'),control('slow',.55,2200)],pierce:0,tickMs:150,recoveryMs:160,projectileSpeed:700,coneAngle:.9,traits:[]},
 life:{name:'生命术',delivery:'targeted',castMs:300,channel:false,range:480,radius:55,effects:[{type:'heal',amount:30}],pierce:0,tickMs:150,recoveryMs:180,projectileSpeed:0,coneAngle:.9,traits:[]},
 lightning:{name:'雷击',delivery:'targeted',castMs:80,channel:false,range:620,radius:85,effects:[damage('lightning',36),status('shocked',1,900)],pierce:0,tickMs:150,recoveryMs:160,projectileSpeed:0,coneAngle:.9,traits:[]},
 water:{name:'水流',delivery:'beam',castMs:180,channel:true,range:1600,radius:18,effects:[damage('water',6),status('wet'),control('knockback',75,120)],pierce:0,tickMs:120,recoveryMs:180,projectileSpeed:0,coneAngle:.9,traits:[]},
 shield:{name:'个人护盾',delivery:'self',castMs:120,channel:false,range:0,radius:0,effects:[status('shielded',1,7000)],pierce:0,tickMs:150,recoveryMs:120,projectileSpeed:0,coneAngle:.9,traits:[]}
};

type Modifier=(plan:SpellPlan)=>SpellPlan;
const scaleDamage=(p:SpellPlan,m:number,element?:Element)=>({...p,effects:p.effects.map(e=>e.type==='damage'&&(!element||e.element===element)?{...e,amount:Math.round(e.amount*m)}:e)});
const scaleControl=(p:SpellPlan,m:number)=>({...p,effects:p.effects.map(e=>e.type==='control'?{...e,control:{...e.control,strength:e.control.strength*m,durationMs:Math.round(e.control.durationMs*m)}}:e)});
const addTrait=(p:SpellPlan,trait:SpellPlan['traits'][number])=>({...p,traits:[...p.traits,trait]});
const addStatus=(p:SpellPlan,kind:StatusKind,stacks=1,durationMs=4000)=>({...p,effects:[...p.effects,...Array.from({length:stacks},()=>status(kind,1,durationMs))]});
export const POSITION_MODIFIERS:Record<2|3|4,Record<Element,Modifier>>={
 2:{
  rock:p=>scaleControl({...p,radius:Math.round(p.radius*1.2)},1.2),fire:p=>scaleDamage({...p,radius:Math.round(p.radius*1.18),coneAngle:p.coneAngle*1.18},1.08),ice:p=>({...p,range:Math.round(p.range*1.2),projectileSpeed:Math.round(p.projectileSpeed*1.2),pierce:p.pierce+1}),life:p=>({...p,radius:Math.round(p.radius*1.25),effects:[...p.effects,{type:'heal',amount:8}]}),lightning:p=>({...p,radius:Math.round(p.radius*1.18),pierce:p.pierce+1}),water:p=>scaleControl({...p,radius:Math.round(p.radius*1.3)},1.2),shield:p=>scaleDamage({...p,pierce:p.pierce+1,effects:p.effects.map(e=>e.type==='environment'?{...e,durationMs:Math.round(e.durationMs*1.25)}:e)},.9)
 },
 3:{
  rock:p=>({...scaleDamage(p,1.28),castMs:Math.round(p.castMs*1.12)}),fire:p=>addStatus(scaleDamage(p,1.18,'fire'),'burning'),ice:p=>addStatus(scaleDamage(p,1.1),'chilled'),life:p=>({...scaleDamage(p,.88),effects:p.effects.map(e=>e.type==='heal'?{...e,amount:Math.round(e.amount*1.35)}:e)}),lightning:p=>({...scaleDamage(p,1.22,'lightning'),recoveryMs:Math.round(p.recoveryMs*.9)}),water:p=>scaleControl({...p,effects:p.effects.map(e=>e.type==='status'?{...e,durationMs:Math.round(e.durationMs*1.3)}:e)},1.2),shield:p=>scaleControl({...p,effects:p.effects.map(e=>e.type==='status'?{...e,durationMs:Math.round(e.durationMs*1.35)}:e)},1.35)
 },
 4:{rock:p=>addTrait(p,'shockwave'),fire:p=>addTrait(p,'ember-burst'),ice:p=>addTrait(p,'ice-shards'),life:p=>addTrait(p,'overflow-heal'),lightning:p=>addTrait(p,'chain'),water:p=>addTrait(p,'water-pool'),shield:p=>addTrait(p,'self-ward')}
};

function same(a:readonly Element[],b:readonly Element[]){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
export function resolveSpell(elements:readonly Element[],staff?:StaffModifier):SpellPlan|null{
 if(!elements.length)return null; const recipe=RECIPES.find(r=>same(r.pattern,elements));
 let plan:SpellPlan=recipe?{...recipe,elements:[...elements],channel:Boolean(recipe.channel),pierce:recipe.pierce??0,tickMs:recipe.tickMs??150,recoveryMs:recipe.recoveryMs??180,projectileSpeed:recipe.projectileSpeed??600,coneAngle:recipe.coneAngle??.9,traits:[...(recipe.traits??[])]}:{id:`mixed:${elements.join('-')}`,elements:[...elements],...bases[elements[0]! ],traits:[]};
 if(!recipe&&elements.length>1){plan={...plan,name:`混合${plan.name}`};for(let i=1;i<elements.length;i++)plan=POSITION_MODIFIERS[(i+1) as 2|3|4][elements[i]!](plan);}
 plan={...plan,presentation:presentationFor(plan)};return staff?.matches(plan)?staff.transform(plan):plan;
}
export function presentationFor(plan:Pick<SpellPlan,'id'|'delivery'>):SpellPresentation{return{telegraph:plan.id==='meteor'?'target-circle':plan.delivery==='area'||plan.delivery==='targeted'?'target-circle':plan.delivery==='cone'?'cone':'none',syncExecution:true,...(plan.delivery==='beam'?{channelUpdateMs:48}: {})};}

export function applyStatus(current:readonly StatusInstance[],next:StatusInstance,now:number){
 const result=current.filter(s=>s.expiresAt==null||s.expiresAt>now).map(s=>({...s})); const found=result.find(s=>s.kind===next.kind);
 if(found){found.intensity=Math.max(found.intensity,next.intensity);found.stacks=Math.min(5,found.stacks+next.stacks);found.expiresAt=Math.max(found.expiresAt??0,next.expiresAt??0)||null;}else result.push({...next}); return result;
}
export function resolveStatusApplication(current:readonly StatusInstance[],next:StatusInstance,now:number,freezeImmuneUntil=0){
 let statuses=current.map(s=>({...s}));
 if((next.kind==='burning'&&statuses.some(s=>s.kind==='fire-ward'))||((next.kind==='chilled'||next.kind==='frozen')&&statuses.some(s=>s.kind==='frost-ward'))||(next.kind==='wet'&&statuses.some(s=>s.kind==='water-ward')))return{statuses,froze:false};
 if(next.kind==='wet')statuses=statuses.filter(s=>s.kind!=='burning');
 else if(next.kind==='burning'&&statuses.some(s=>s.kind==='wet'))return{statuses,froze:false};
 if(next.kind==='chilled'&&now>=freezeImmuneUntil){const stacks=(statuses.find(s=>s.kind==='chilled')?.stacks??0)+next.stacks;if(stacks>=3){statuses=statuses.filter(s=>s.kind!=='chilled');statuses=applyStatus(statuses,{kind:'frozen',intensity:1,stacks:1,sourceId:next.sourceId,expiresAt:now+1500},now);return{statuses,froze:true};}}
 return{statuses:applyStatus(statuses,next,now),froze:false};
}
export function reactDamage(statuses:readonly StatusInstance[],element:Element,amount:number){
 const has=(k:StatusKind)=>statuses.some(s=>s.kind===k); let multiplier=1, reaction='';
 if(element==='fire'&&has('wet')){multiplier=1.5;reaction='蒸发';}
 if(element==='lightning'&&has('wet')){multiplier=1.45;reaction='导电';}
 if(element==='rock'&&has('frozen')){multiplier=1.6;reaction='碎裂';}
 return{amount:Math.round(amount*multiplier),reaction};
}
export function beamPower(elapsedMs:number){return elapsedMs<=1500?1:Math.max(.55,1-(elapsedMs-1500)/2500*.45);}
export function isRecipeId(id:string){return RECIPES.some(r=>r.id===id);}
export function canQueueLightning(elements:readonly Element[],statuses:readonly StatusInstance[]){return !statuses.some(s=>s.kind==='wet')||elements.includes('shield');}
