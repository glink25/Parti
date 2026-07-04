export const SCHEMA_VERSION=1, WORLD_WIDTH=1600, WORLD_HEIGHT=900, HUD_HEIGHT=118, ELEMENT_SLOTS=4;
export type Element='rock'|'fire'|'ice'|'life'|'lightning'|'water'|'shield';
export const ELEMENTS:readonly Element[]=['rock','fire','ice','life','lightning','water','shield'];
export type Delivery='projectile'|'cone'|'beam'|'targeted'|'area'|'global'|'self';
export type StatusKind='wet'|'burning'|'chilled'|'frozen'|'shocked'|'shielded';
export type StatusInstance={kind:StatusKind;intensity:number;stacks:number;sourceId:string;expiresAt:number|null};
export type SpellEffect=
 |{type:'damage';element:Element;amount:number}
 |{type:'heal';amount:number}
 |{type:'status';status:StatusKind;intensity:number;durationMs:number}
 |{type:'impulse';amount:number}
 |{type:'environment';kind:'rain'|'steam';durationMs:number;radius?:number};
export type SpellPlan={id:string;name:string;elements:Element[];delivery:Delivery;castMs:number;channel:boolean;range:number;radius:number;effects:SpellEffect[]};
export type SpellRecipe={id:string;name:string;pattern:Element[];delivery:Delivery;castMs:number;channel?:boolean;range:number;radius:number;effects:SpellEffect[]};
export type StaffModifier={id:string;matches(plan:SpellPlan):boolean;transform(plan:SpellPlan):SpellPlan};
export type PublicPlayer={id:string;name:string;ready:boolean;connected:boolean;x:number;y:number;hp:number;downed:boolean;sequence:number;elements:Element[];statuses:StatusInstance[];kills:number};
export type EnemyKind='chaser'|'shooter'|'water-fiend';
export type EnemyState={id:string;kind:EnemyKind;x:number;y:number;hp:number;maxHp:number;radius:number;targetId:string|null;attackAt:number;statuses:StatusInstance[]};
export type EnvironmentState={id:string;kind:'rain'|'steam';x:number;y:number;radius:number;startedAt:number;endsAt:number};
export type Phase='lobby'|'running'|'gameover';
export type GameState={schemaVersion:number;phase:Phase;hostId:string|null;startedAt:number|null;players:Record<string,PublicPlayer>;enemies:Record<string,EnemyState>;environments:Record<string,EnvironmentState>;worldSequence:number;damageEvents:string[];totalKills:number;message:string};
export type PlayerReport={sequence:number;x:number;y:number;hp:number;downed:boolean;elements:Element[];statuses:StatusInstance[];kills:number};
export type HostWorldReport={sequence:number;enemies:EnemyState[];environments:EnvironmentState[]};
export type EnemyDamageReport={eventId:string;enemyId:string;sourcePlayerId:string;spellId:string;amount:number;statuses:StatusInstance[]};
export type PlayerEffectReport={eventId:string;targetPlayerId:string;effects:SpellEffect[]};
export type PartiApi={playerId:string|null;getState():unknown;onState(h:(s:unknown)=>void):()=>void;onEvent(e:string,h:(p:unknown)=>void):()=>void;action(a:string,p?:unknown):Promise<{ok:true}>;ready():void;leave():void};
declare global{const parti:PartiApi}
