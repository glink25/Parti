import type { Element, SpellEffect, SpellPlan, SpellRecipe, StaffModifier, StatusInstance, StatusKind } from './contracts';

const damage=(element:Element,amount:number):SpellEffect=>({type:'damage',element,amount});
const status=(kind:StatusKind,intensity=1,durationMs=4000):SpellEffect=>({type:'status',status:kind,intensity,durationMs});
const control=(kind:'knockback'|'knockup'|'slow'|'stun',strength:number,durationMs:number):SpellEffect=>({type:'control',control:{kind,strength,durationMs}});

export const RECIPES:readonly SpellRecipe[]=[
 {id:'flame-beam',name:'生命烈焰',pattern:['fire','life'],delivery:'beam',castMs:240,channel:true,tickMs:140,recoveryMs:220,range:1600,radius:18,effects:[damage('fire',9),status('burning',1,3500)]},
 {id:'meteor',name:'天降陨石',pattern:['fire','rock','rock','fire'],delivery:'targeted',castMs:850,range:900,radius:145,effects:[damage('fire',75),damage('rock',45),status('burning',2,5000),control('knockup',520,700)]},
 {id:'rain',name:'全场降雨',pattern:['fire','water','water','fire'],delivery:'global',castMs:900,range:0,radius:0,effects:[{type:'environment',kind:'rain',durationMs:12000}]},
 {id:'freeze-stream',name:'冻结水流',pattern:['water','ice'],delivery:'beam',castMs:220,channel:true,tickMs:130,recoveryMs:200,range:1600,radius:18,effects:[damage('ice',7),status('wet'),status('frozen',1,1800),control('slow',.35,2200),control('stun',1,900)]},
 {id:'steam-cloud',name:'蒸汽云',pattern:['fire','water'],delivery:'area',castMs:320,range:650,radius:120,effects:[damage('fire',18),{type:'environment',kind:'steam',durationMs:5500,radius:120}]},
 {id:'lava-shot',name:'熔岩弹',pattern:['rock','fire'],delivery:'projectile',castMs:260,projectileSpeed:520,range:720,radius:48,effects:[damage('rock',34),damage('fire',26),status('burning'),control('knockback',300,350)]},
 {id:'healing-pool',name:'生命之泉',pattern:['water','life'],delivery:'area',castMs:400,range:600,radius:120,effects:[{type:'heal',amount:35},status('wet')]},
 {id:'shatter-shot',name:'碎冰岩弹',pattern:['rock','ice'],delivery:'projectile',castMs:260,projectileSpeed:600,range:700,radius:42,effects:[damage('rock',40),damage('ice',18),status('chilled'),control('knockup',440,650)]},
 {id:'storm-chain',name:'导电水链',pattern:['water','lightning'],delivery:'targeted',castMs:220,range:700,radius:150,effects:[damage('lightning',42),status('wet'),status('shocked',1,1200),control('stun',1,700)]},
 {id:'flamethrower',name:'烈焰喷射',pattern:['fire','fire'],delivery:'cone',castMs:120,range:390,radius:90,coneAngle:1.05,effects:[damage('fire',40),status('burning',2)]},
 {id:'stone-ward',name:'岩石护盾',pattern:['shield','rock'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',2,9000)]},
 {id:'fire-ward',name:'火焰护盾',pattern:['shield','fire'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000),status('burning',1,3000)]},
 {id:'frost-ward',name:'寒冰护盾',pattern:['shield','ice'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000),status('chilled',1,3000)]},
 {id:'grounding-ward',name:'接地护盾',pattern:['shield','lightning'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000)]},
 {id:'water-ward',name:'流水护盾',pattern:['shield','water'],delivery:'self',castMs:180,range:0,radius:0,effects:[status('shielded',1,9000),status('wet',1,2500)]}
];

const bases:Record<Element,Omit<SpellPlan,'id'|'elements'>>={
 rock:{name:'岩弹',delivery:'projectile',castMs:220,channel:false,range:680,radius:34,effects:[damage('rock',38),control('knockback',360,400)],pierce:0,tickMs:150,recoveryMs:180,projectileSpeed:650,coneAngle:.9},
 fire:{name:'火焰',delivery:'cone',castMs:100,channel:false,range:300,radius:28,effects:[damage('fire',32),status('burning')],pierce:0,tickMs:150,recoveryMs:140,projectileSpeed:600,coneAngle:1.05},
 ice:{name:'冰弹',delivery:'projectile',castMs:160,channel:false,range:650,radius:30,effects:[damage('ice',28),status('chilled'),control('slow',.55,2200)],pierce:0,tickMs:150,recoveryMs:160,projectileSpeed:700,coneAngle:.9},
 life:{name:'生命术',delivery:'targeted',castMs:300,channel:false,range:480,radius:55,effects:[{type:'heal',amount:30}],pierce:0,tickMs:150,recoveryMs:180,projectileSpeed:0,coneAngle:.9},
 lightning:{name:'雷击',delivery:'targeted',castMs:80,channel:false,range:620,radius:85,effects:[damage('lightning',36),status('shocked',1,900),control('stun',1,650)],pierce:0,tickMs:150,recoveryMs:160,projectileSpeed:0,coneAngle:.9},
 water:{name:'水流',delivery:'beam',castMs:180,channel:true,range:1600,radius:18,effects:[damage('water',6),status('wet'),control('knockback',75,120)],pierce:0,tickMs:120,recoveryMs:180,projectileSpeed:0,coneAngle:.9},
 shield:{name:'个人护盾',delivery:'self',castMs:120,channel:false,range:0,radius:0,effects:[status('shielded',1,7000)],pierce:0,tickMs:150,recoveryMs:120,projectileSpeed:0,coneAngle:.9}
};

function same(a:readonly Element[],b:readonly Element[]){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
export function resolveSpell(elements:readonly Element[],staff?:StaffModifier):SpellPlan|null{
 if(!elements.length)return null; const recipe=RECIPES.find(r=>same(r.pattern,elements));
 let plan:SpellPlan=recipe?{...recipe,elements:[...elements],channel:Boolean(recipe.channel),pierce:recipe.pierce??0,tickMs:recipe.tickMs??150,recoveryMs:recipe.recoveryMs??180,projectileSpeed:recipe.projectileSpeed??600,coneAngle:recipe.coneAngle??.9}:{id:`mixed:${elements.join('-')}`,elements:[...elements],...bases[elements[0]! ]};
 if(!recipe&&elements.length>1){const repeats=elements.slice(1).filter(e=>e===elements[0]).length;const extras=elements.length-1;plan={...plan,name:`混合${plan.name}`,radius:plan.radius+extras*12,range:plan.range+extras*45,effects:plan.effects.map(e=>e.type==='damage'?{...e,amount:Math.round(e.amount*(1+extras*.22+repeats*.18))}:e)};}
 return staff?.matches(plan)?staff.transform(plan):plan;
}

export function applyStatus(current:readonly StatusInstance[],next:StatusInstance,now:number){
 const result=current.filter(s=>s.expiresAt==null||s.expiresAt>now).map(s=>({...s})); const found=result.find(s=>s.kind===next.kind);
 if(found){found.intensity=Math.max(found.intensity,next.intensity);found.stacks=Math.min(5,found.stacks+next.stacks);found.expiresAt=Math.max(found.expiresAt??0,next.expiresAt??0)||null;}else result.push({...next}); return result;
}
export function reactDamage(statuses:readonly StatusInstance[],element:Element,amount:number){
 const has=(k:StatusKind)=>statuses.some(s=>s.kind===k); let multiplier=1, reaction='';
 if(element==='fire'&&has('wet')){multiplier=1.5;reaction='蒸发';}
 if(element==='lightning'&&has('wet')){multiplier=1.45;reaction='导电';}
 if(element==='rock'&&has('frozen')){multiplier=1.6;reaction='碎裂';}
 return{amount:Math.round(amount*multiplier),reaction};
}
export function canQueueLightning(elements:readonly Element[],statuses:readonly StatusInstance[]){return !statuses.some(s=>s.kind==='wet')||elements.includes('shield');}
