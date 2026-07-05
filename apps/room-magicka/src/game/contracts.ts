export const SCHEMA_VERSION=14, WORLD_WIDTH=7800, WORLD_HEIGHT=5100, ELEMENT_SLOTS=4;
export const BIOMES=['ruins','swamp','volcano'] as const;
export type BiomeId=(typeof BIOMES)[number];
export type Point={x:number;y:number};
export type Element='rock'|'fire'|'ice'|'life'|'lightning'|'water'|'shield';
export const ELEMENTS:readonly Element[]=['rock','fire','ice','life','lightning','water','shield'];
export type Delivery='projectile'|'cone'|'beam'|'targeted'|'area'|'global'|'self';
export type StatusKind='wet'|'burning'|'chilled'|'frozen'|'shocked'|'shielded'|'fire-ward'|'frost-ward'|'water-ward'|'haste';
export type ControlKind='knockback'|'knockup'|'slow'|'stun';
export type StatusInstance={kind:StatusKind;intensity:number;stacks:number;sourceId:string;expiresAt:number|null};
export type ControlEffect={kind:ControlKind;strength:number;durationMs:number};
export type ControlState={vx:number;vy:number;z:number;vz:number;slowedUntil:number;slowScale:number;stunnedUntil:number};
export type SpellEffect=
 |{type:'damage';element:Element;amount:number}
 |{type:'heal';amount:number}
 |{type:'revive';healthRatio:number}
 |{type:'current-health-damage';ratio:number;bossRatio?:number}
 |{type:'set-health';ratio:number}
 |{type:'cleanse'}
 |{type:'teleport';maxRange:number}
 |{type:'status';status:StatusKind;intensity:number;durationMs:number}
 |{type:'control';control:ControlEffect}
 |{type:'environment';kind:EnvironmentKind;durationMs:number;radius?:number};
export type SpellTrait='shockwave'|'ember-burst'|'ice-shards'|'overflow-heal'|'chain'|'water-pool'|'self-ward'|'ice-wall'|'storm-field'|'chain-heal'|'gravity-well'|'fire-ring'|'ice-lance'|'tidal-wave'|'life-barrier'|'lightning-barrage';
export type SpellPresentation={telegraph:'none'|'target-circle'|'cone'|'line';syncExecution:boolean;channelUpdateMs?:number};
export type SpellPlan={id:string;name:string;elements:Element[];delivery:Delivery;castMs:number;channel:boolean;range:number;radius:number;effects:SpellEffect[];pierce:number;tickMs:number;recoveryMs:number;projectileSpeed:number;coneAngle:number;traits:SpellTrait[];presentation?:SpellPresentation};
export type SpellRecipe=Omit<SpellPlan,'elements'|'channel'|'pierce'|'tickMs'|'recoveryMs'|'projectileSpeed'|'coneAngle'|'traits'>&Partial<Pick<SpellPlan,'channel'|'pierce'|'tickMs'|'recoveryMs'|'projectileSpeed'|'coneAngle'|'traits'>>&{pattern:Element[]};
export type StaffModifier={id:string;matches(plan:SpellPlan):boolean;transform(plan:SpellPlan):SpellPlan};
export type AimState={plan:SpellPlan;pointerId:number;target:Point;startedAt:number;angle:number};
export type PendingCast={id:string;plan:SpellPlan;origin:Point;target:Point;releasedAt:number;triggersAt:number};
export type ActiveBeam={id:string;plan:SpellPlan;angle:number;targetAngle:number;startedAt:number;nextDamageAt:number;pointerId:number};
export type ActiveProjectile={id:string;ownerId:string;spellId:string;element:Element;x:number;y:number;vx:number;vy:number;radius:number;remainingPierce:number;expiresAt:number;effects:SpellEffect[];traits:SpellTrait[];hitIds:string[]};
export type SpellVisual={id:string;kind:'cone'|'impact'|'beam'|'projectile'|'heal';origin:Point;target:Point;radius:number;angle:number;coneAngle?:number;color:Element;startedAt:number;endsAt:number};
export type SharedSpellVisual={eventId:string;sourcePlayerId:string;kind:SpellVisual['kind'];origin:Point;target:Point;radius:number;angle:number;coneAngle:number;color:Element;durationMs:number};
export type FloatingText={id:string;x:number;y:number;text:string;color:string;startedAt:number;endsAt:number};
export type EquipmentSlot='staff'|'robe'|'ring';
export type EquipmentAffixId='element-power'|'recipe-power'|'stealth'|'tenacity'|'element-immunity'|'beam-reflect'|'beam-pierce'|'combat-vision'|'cast-speed'|'area-power'|'damage-reduction'|'move-speed';
export type EquipmentAffix={id:EquipmentAffixId;level:number;value:number;slot:EquipmentSlot;exclusiveGroup?:'element-immunity'|'beam-path';element?:Element;recipeId?:string};
export type EquipmentStats={elementPower:Partial<Record<Element,number>>;recipePower:Record<string,number>;castSpeed:number;areaPower:number;damageReduction:number;moveSpeed:number;tenacity:number;combatVision:number};
export type EquipmentItem={id:string;prototypeId:string;name:string;slot:EquipmentSlot;rarity:'common'|'uncommon'|'rare';stats:EquipmentStats;affixes:EquipmentAffix[];biome:BiomeId;mechanicId:string;description:string;value:number;fusionGeneration:number;sourceItemValues:number[]};
export type ScrollItem={id:string;kind:'scroll';name:string;spellId:string;cooldownMs:number;description:string};
export type CatalystItem={id:string;kind:'catalyst';name:'稳定符文';description:string};
export type InventoryItem=EquipmentItem|ScrollItem|CatalystItem;
export type PlayerEquipment={staff:EquipmentItem|null;robe:EquipmentItem|null;ring:EquipmentItem|null};
export type PlayerActivityPhase='idle'|'selecting'|'aiming'|'windup'|'channeling'|'recovery'|'interrupted'|'downed'|'stunned';
export type PlayerActivity={phase:PlayerActivityPhase;elements:Element[];spellId:string|null;castId:string|null;phaseStartedAt:number;phaseEndsAt:number|null};
export type PlayerRealtimeFrame={playerId?:string;sequence:number;sentAt:number;x:number;y:number;z:number;activity:PlayerActivity};
export type PublicPlayer={id:string;name:string;ready:boolean;connected:boolean;x:number;y:number;z:number;hp:number;downed:boolean;sequence:number;realtimeSequence:number;activity:PlayerActivity;elements:Element[];statuses:StatusInstance[];controls:ControlState;kills:number;gold:number;equipment:PlayerEquipment;inventory:InventoryItem[];scrollCooldowns:Record<string,number>;stealthBrokenUntil:number};
export type EnemyKind='chaser'|'shooter'|'water-fiend'|'shield-guard'|'reflect-warden'|'resonance-priest'|'mud-stalker'|'spore-pod'|'bog-witch'|'vine-hunter'|'plague-mother'|'thunder-frog'|'lava-hound'|'ash-mage'|'obsidian-beetle'|'flame-construct'|'core-colossus'|'magnet-priest'|'ruin-guardian'|'bog-heart'|'forge-titan';
export type EnemyAttackKind='melee'|'bolt'|'water-bolt'|'water-slam';
export type EnemyAttackState={kind:EnemyAttackKind;targetId:string;startedAt:number;firesAt:number;element?:Element};
export type EnemyTag='undead';
export type EnemyState={id:string;roomId:string;kind:EnemyKind;x:number;y:number;hp:number;maxHp:number;radius:number;targetId:string|null;nextAttackAt:number;attack:EnemyAttackState|null;statuses:StatusInstance[];controls:ControlState;flashUntil:number;revision:number;tags?:EnemyTag[];freezeImmuneUntil?:number;lastStatusTickAt?:number;elite?:boolean;behaviorPhase?:number;mechanicState?:string};
export type HostProjectile={id:string;roomId:string;kind:'bolt'|'water-bolt';sourceId:string;x:number;y:number;vx:number;vy:number;radius:number;damage:number;element?:Element;expiresAt:number;control?:ControlEffect};
export type EnvironmentKind='rain'|'steam'|'water-pool'|'ice-wall'|'storm-field'|'gravity-well'|'fire-ring'|'life-barrier'|'overflow-heal'|'blizzard'|'lightning-barrage';
export type EnvironmentState={id:string;kind:EnvironmentKind;x:number;y:number;radius:number;startedAt:number;endsAt:number;sourcePlayerId?:string;lastTickAt?:number;power?:number};
export type RoomTemplateKind='standard'|'wide'|'tall';
export type MapRoom={id:string;gridX:number;gridY:number;gridWidth:number;gridHeight:number;templateKind:RoomTemplateKind;templateTags:string[];x:number;y:number;width:number;height:number;connections:string[]};
export type MapCorridor={id:string;fromRoomId:string;toRoomId:string;x:number;y:number;width:number;height:number};
export type HazardKind='falling-rock'|'rune-wall'|'shallow-water'|'mud'|'poison-water'|'conductive-water'|'lava'|'vent'|'safe-zone';
export type HazardState={id:string;roomId:string;kind:HazardKind;x:number;y:number;radius:number;phase:'idle'|'warning'|'active';startsAt:number;endsAt:number;revision:number};
export type WorldEventKind='merchant'|'forge'|'chest'|'cursed-chest'|'elite'|'healing-spring'|'element-shrine';
export type WorldEventState={id:string;roomId:string;kind:WorldEventKind;x:number;y:number;status:'available'|'active'|'completed';revision:number};
export type MapManifest={generationVersion:number;seed:number;stageSeed:number;biome:BiomeId;width:number;height:number;spawn:Point;rooms:MapRoom[];corridors:MapCorridor[];hazards:HazardState[];events:WorldEventState[]};
export type EncounterKind='roaming'|'sealed';
export type EncounterStatus='dormant'|'active'|'cleared';
export type ElementChallenge={element:Exclude<Element,'shield'>;active:boolean};
export type RegionEncounter={roomId:string;kind:EncounterKind;status:EncounterStatus;enemyCount:number;activatedAt:number|null;clearedAt:number|null;challenge?:ElementChallenge|null};
export type ObjectiveKind='elite'|'altar'|'puzzle';
export type ObjectiveStatus='dormant'|'active'|'completed';
export type StageObjective={id:string;roomId:string;kind:ObjectiveKind;status:ObjectiveStatus;progress:number;target:number;startedAt:number|null};
export type BossStatus='locked'|'available'|'active'|'defeated';
export type BossMechanic={id:string;kind:'rune-pillar'|'purifier'|'cooling-rune';x:number;y:number;progress:number;target:number;active:boolean};
export type BossArenaState={phase:'idle'|'warning'|'active';warningStartsAt:number;activeStartsAt:number;endsAt:number};
export type StageBoss={roomId:string;status:BossStatus;enemyId:string|null;phase:number;nextMechanicAt:number;arena:BossArenaState;mechanics:BossMechanic[];challenge:ElementChallenge|null};
export type StagePortal={roomId:string;x:number;y:number;active:boolean};
export type StageProgress={index:number;biome:BiomeId;status:'exploring'|'boss'|'complete';startedAt:number;completedAt:number|null;requiredSigils:number;objectives:StageObjective[];boss:StageBoss;portal:StagePortal|null};
export type LootEntity={id:string;x:number;y:number;roomId:string;item:InventoryItem;wants:string[];droppedByPlayerId:string|null;ownerPriorityUntil:number};
export type MerchantState={id:string;x:number;y:number;roomId:string;stock:Array<{item:InventoryItem;price:number}>};
export type VictorySummary={durationMs:number;totalKills:number;totalGold:number;playerBuilds:Array<{playerId:string;name:string;equipment:PlayerEquipment}>};
export type CastPhase='committed'|'resolved'|'channeling'|'cancelled'|'ended';
export type ActiveCast={castId:string;sourcePlayerId:string;spellId:string;phase:CastPhase;origin:Point;target:Point;committedAt:number;resolveAt:number;revision:number};
export type SpellCastReport={castId:string;spellId:string;elements:Element[];phase:CastPhase;origin:Point;target:Point;revision:number};
export type Phase='lobby'|'running'|'gameover'|'victory';
export type GameState={schemaVersion:number;phase:Phase;hostId:string|null;startedAt:number|null;runSeed:number;stageIndex:number;biome:BiomeId;stageSeed:number;stage:StageProgress|null;activeCasts:Record<string,ActiveCast>;discoveredRecipeIds:string[];exploredRoomIds:string[];players:Record<string,PublicPlayer>;enemies:Record<string,EnemyState>;projectiles:Record<string,HostProjectile>;environments:Record<string,EnvironmentState>;hazards:Record<string,HazardState>;events:Record<string,WorldEventState>;encounters:Record<string,RegionEncounter>;loot:Record<string,LootEntity>;merchants:Record<string,MerchantState>;rewardEventIds:string[];authorityEventIds:string[];worldSequence:number;totalKills:number;victorySummary:VictorySummary|null;message:string};
export type PlayerReport={sequence:number;x:number;y:number;z:number;hp:number;downed:boolean;elements:Element[];statuses:StatusInstance[];controls:ControlState;kills:number};
export type HostWorldReport={sequence:number;enemies:EnemyState[];projectiles:HostProjectile[];environments:EnvironmentState[];hazards:HazardState[];events:WorldEventState[];encounters:RegionEncounter[];stage:StageProgress;loot:LootEntity[];merchants:MerchantState[]};
export type EnemyDamageReport={eventId:string;worldSequence:number;enemyId:string;sourcePlayerId:string;spellId:string;amount:number;statuses:StatusInstance[];controls:ControlEffect[];direction:Point};
export type PlayerEffectReport={eventId:string;targetPlayerId:string;effects:SpellEffect[];direction:Point};
export type PartiApi={playerId:string|null;getState():unknown;onState(h:(s:unknown)=>void):()=>void;onEvent(e:string,h:(p:unknown)=>void):()=>void;action(a:string,p?:unknown):Promise<{ok:true}>;ready():void;leave():void};
declare global{const parti:PartiApi}
