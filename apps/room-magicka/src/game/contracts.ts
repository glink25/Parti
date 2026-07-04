export const SCHEMA_VERSION=2, WORLD_WIDTH=1600, WORLD_HEIGHT=900, HUD_HEIGHT=118, ELEMENT_SLOTS=4;
export type Point={x:number;y:number};
export type Element='rock'|'fire'|'ice'|'life'|'lightning'|'water'|'shield';
export const ELEMENTS:readonly Element[]=['rock','fire','ice','life','lightning','water','shield'];
export type Delivery='projectile'|'cone'|'beam'|'targeted'|'area'|'global'|'self';
export type StatusKind='wet'|'burning'|'chilled'|'frozen'|'shocked'|'shielded';
export type ControlKind='knockback'|'knockup'|'slow'|'stun';
export type StatusInstance={kind:StatusKind;intensity:number;stacks:number;sourceId:string;expiresAt:number|null};
export type ControlEffect={kind:ControlKind;strength:number;durationMs:number};
export type ControlState={vx:number;vy:number;z:number;vz:number;slowedUntil:number;slowScale:number;stunnedUntil:number};
export type SpellEffect=
 |{type:'damage';element:Element;amount:number}
 |{type:'heal';amount:number}
 |{type:'status';status:StatusKind;intensity:number;durationMs:number}
 |{type:'control';control:ControlEffect}
 |{type:'environment';kind:'rain'|'steam';durationMs:number;radius?:number};
export type SpellPlan={id:string;name:string;elements:Element[];delivery:Delivery;castMs:number;channel:boolean;range:number;radius:number;effects:SpellEffect[];pierce:number;tickMs:number;recoveryMs:number;projectileSpeed:number;coneAngle:number};
export type SpellRecipe=Omit<SpellPlan,'elements'|'channel'|'pierce'|'tickMs'|'recoveryMs'|'projectileSpeed'|'coneAngle'>&Partial<Pick<SpellPlan,'channel'|'pierce'|'tickMs'|'recoveryMs'|'projectileSpeed'|'coneAngle'>>&{pattern:Element[]};
export type StaffModifier={id:string;matches(plan:SpellPlan):boolean;transform(plan:SpellPlan):SpellPlan};
export type AimState={plan:SpellPlan;pointerId:number;target:Point;startedAt:number;angle:number};
export type PendingCast={id:string;plan:SpellPlan;origin:Point;target:Point;releasedAt:number;triggersAt:number};
export type ActiveBeam={id:string;plan:SpellPlan;angle:number;targetAngle:number;startedAt:number;nextDamageAt:number;pointerId:number};
export type ActiveProjectile={id:string;ownerId:string;spellId:string;element:Element;x:number;y:number;vx:number;vy:number;radius:number;remainingPierce:number;expiresAt:number;effects:SpellEffect[];hitIds:string[]};
export type SpellVisual={id:string;kind:'cone'|'impact'|'beam'|'heal';origin:Point;target:Point;radius:number;angle:number;color:Element;startedAt:number;endsAt:number};
export type FloatingText={id:string;x:number;y:number;text:string;color:string;startedAt:number;endsAt:number};
export type PublicPlayer={id:string;name:string;ready:boolean;connected:boolean;x:number;y:number;z:number;hp:number;downed:boolean;sequence:number;elements:Element[];statuses:StatusInstance[];controls:ControlState;kills:number};
export type EnemyKind='chaser'|'shooter'|'water-fiend';
export type EnemyAttackKind='melee'|'bolt'|'water-bolt'|'water-slam';
export type EnemyAttackState={kind:EnemyAttackKind;targetId:string;startedAt:number;firesAt:number};
export type EnemyState={id:string;kind:EnemyKind;x:number;y:number;hp:number;maxHp:number;radius:number;targetId:string|null;nextAttackAt:number;attack:EnemyAttackState|null;statuses:StatusInstance[];controls:ControlState;flashUntil:number;revision:number};
export type HostProjectile={id:string;kind:'bolt'|'water-bolt';sourceId:string;x:number;y:number;vx:number;vy:number;radius:number;damage:number;expiresAt:number;control?:ControlEffect};
export type EnvironmentState={id:string;kind:'rain'|'steam';x:number;y:number;radius:number;startedAt:number;endsAt:number};
export type Phase='lobby'|'running'|'gameover';
export type GameState={schemaVersion:number;phase:Phase;hostId:string|null;startedAt:number|null;players:Record<string,PublicPlayer>;enemies:Record<string,EnemyState>;projectiles:Record<string,HostProjectile>;environments:Record<string,EnvironmentState>;worldSequence:number;totalKills:number;message:string};
export type PlayerReport={sequence:number;x:number;y:number;z:number;hp:number;downed:boolean;elements:Element[];statuses:StatusInstance[];controls:ControlState;kills:number};
export type HostWorldReport={sequence:number;enemies:EnemyState[];projectiles:HostProjectile[];environments:EnvironmentState[]};
export type EnemyDamageReport={eventId:string;worldSequence:number;enemyId:string;sourcePlayerId:string;spellId:string;amount:number;statuses:StatusInstance[];controls:ControlEffect[];direction:Point};
export type PlayerEffectReport={eventId:string;targetPlayerId:string;effects:SpellEffect[];direction:Point};
export type PartiApi={playerId:string|null;getState():unknown;onState(h:(s:unknown)=>void):()=>void;onEvent(e:string,h:(p:unknown)=>void):()=>void;action(a:string,p?:unknown):Promise<{ok:true}>;ready():void;leave():void};
declare global{const parti:PartiApi}
