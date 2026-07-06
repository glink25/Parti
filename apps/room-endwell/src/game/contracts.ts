export type Vec2 = { x: number; y: number };
export type Element = 'rock' | 'fire' | 'ice' | 'life' | 'lightning' | 'water' | 'shield';
export type DamageElement = 'physical' | Element | 'pure';
export type ElementStatusType = 'wet' | 'burning' | 'chilled' | 'frozen' | 'shocked' | 'poisoned' | 'shielded' | 'stoneArmor' | 'regenerating';
export type DeliveryType = 'spray' | 'beam' | 'projectile' | 'summon' | 'area' | 'environment' | 'shield';
export type CastPhase = 'idle' | 'chanting' | 'warning' | 'active' | 'recovery' | 'interrupted';
export type FactionTeam = 'player' | 'monster' | 'neutral' | 'environment';
export type EquipmentSlot = 'staff' | 'robe' | 'ring';
export type EquipmentRarity = 'normal' | 'excellent' | 'rare';

export type TargetingSpec = { canHitSelf: boolean; canHitAllies: boolean; canHitEnemies: boolean; canHitNeutral: boolean; beneficial?: boolean };
export type BlockingSpec = { blockBySelf: boolean; blockByAllies: boolean; blockByEnemies: boolean; blockByNeutral: boolean; blockByWalls: boolean; blockBySummons: boolean };
export type HitPayload = { damage?: Partial<Record<DamageElement, number>>; heal?: number; statusBuildup?: Partial<Record<ElementStatusType, number>>; effects?: Array<{ type: 'knockback'; force: number } | { type: 'interrupt'; power: number }> };
export type ElementVector = Record<Element, number>;
export type SummonArchetype = 'rock-wall' | 'ice-wall' | 'fire-field' | 'lightning-field' | 'water-pool' | 'healing-field';
export type BeamSpec = { width: number; tickInterval: number; mode: 'normal' | 'reflect' | 'pierce' };
export type SummonSpec = { archetype: SummonArchetype; positionMode: 'targetPoint' | 'casterFront' | 'self' | 'global' };
export type AreaSpec = { warningMs: number; impactDelay: number };
export type EnvironmentSpec = { kind: 'rain'; duration: number; tickInterval: number };
export type ShieldSpec = { amount: number; absorbElements: Partial<Record<DamageElement, number>> };
export type SpellSpec = { id: string; name: string; elements: Element[]; elementVector: ElementVector; delivery: DeliveryType; payload: HitPayload; chantMs: number; recoveryMs: number; detached: boolean; channelled: boolean; lifetimeMs: number; speed?: number; range: number; radius: number; coneAngle?: number; beam?: BeamSpec; summon?: SummonSpec; area?: AreaSpec; environment?: EnvironmentSpec; shield?: ShieldSpec; targeting: TargetingSpec; blocking: BlockingSpec; tags: string[]; visualKey: string };
export type StatModifier = { stat: string; op: 'add' | 'multiply' | 'override' | 'min' | 'max'; value: number | string | boolean; priority?: number };
export type BuffInstance = { id: string; sourceId?: string; endsAt?: number; stacks: number; modifiers: StatModifier[]; tags: string[] };
export type ShieldLayer = { id: string; amount: number; maxAmount: number; absorbElements: Partial<Record<DamageElement, number>>; priority: number; tags: string[] };
export type StatusInstance = { type: ElementStatusType; endsAt: number; potency: number; stacks: number; sourceId?: string; tags: string[] };
export type CastState = { phase: CastPhase; castId: string | null; spell: SpellSpec | null; startedAt: number; phaseEndsAt: number | null; aim: Vec2; target: Vec2 };
export type Combatant = { health: { current: number; max: number }; damageable: { canReceiveDamage: boolean; canReceiveHeal: boolean; invincible?: boolean }; faction: { id: string; team: FactionTeam }; statuses: Partial<Record<ElementStatusType, StatusInstance>>; buildup: Partial<Record<ElementStatusType, number>>; buffs: BuffInstance[]; shields: ShieldLayer[]; resistances: Partial<Record<DamageElement, number>>; cast: CastState };
export type EquipmentAffix =
  | { type: 'elementDamageBonus'; element: Exclude<Element, 'life' | 'shield'>; value: number }
  | { type: 'lifeHealBonus'; value: number }
  | { type: 'globalDamageReduction'; value: number }
  | { type: 'elementDamageReduction'; element: DamageElement; value: number }
  | { type: 'moveSpeedBonus'; value: number }
  | { type: 'chantTimeReduction'; value: number }
  | { type: 'recoveryTimeReduction'; value: number }
  | { type: 'rangeBonus'; delivery: 'spray' | 'beam' | 'projectile' | 'area' | 'summon'; value: number };
export type EquipmentItem = { id: string; slot: EquipmentSlot; rarity: EquipmentRarity; name: string; visualKey: string; affixes: EquipmentAffix[]; tags: string[]; description: string; value: number; fusionGeneration: number; sourceItemValues: number[] };
export type CatalystItem = { id: string; kind: 'catalyst'; name: string; description: string; value: number };
export type InventoryItem = EquipmentItem | CatalystItem;
export type PlayerEquipment = { staff?: EquipmentItem; robe?: EquipmentItem; ring?: EquipmentItem };
export type LootEntity = { id: string; position: Vec2; item: InventoryItem; droppedByPlayerId: string | null; ownerPriorityUntil: number };
export type MerchantState = { id: string; position: Vec2; radius: number; stock: Array<{ item: InventoryItem; price: number }> };
export type ForgeState = { id: string; position: Vec2; radius: number };
export type PlayerState = Combatant & { id: string; name: string; connected: boolean; alive: boolean; position: Vec2; aim: Vec2; positionEpoch: number; lastPoseSequence: number; lastCastSequence: number; gold: number; inventory: InventoryItem[]; equipment: PlayerEquipment };
export type EntityKind = 'monster' | 'projectile' | 'wall' | 'field' | 'area' | 'warning';
export type EntityState = Combatant & { id: string; kind: EntityKind; archetype?: SummonArchetype | 'meteor-warning' | 'meteor-impact'; ownerId?: string; position: Vec2; velocity?: Vec2; direction?: Vec2; radius: number; createdAt: number; expiresAt: number | null; detached: boolean; source?: { spell: SpellSpec; tickMs: number; nextTickAt: number }; obstacle?: { blocksMovement: boolean; blocksProjectile: boolean; blocksBeam: boolean; blocksSpray: boolean; material: 'stone' | 'ice' | 'magic' | 'flesh' } };
export type GlobalEnvironment = { id: string; kind: 'rain'; ownerId: string; startedAt: number; endsAt: number; tickInterval: number; nextTickAt: number };
export type GameState = { schemaVersion: 1; phase: 'lobby' | 'running' | 'gameover'; hostId: string | null; seed: number; worldTime: number; startedAt: number | null; players: Record<string, PlayerState>; entities: Record<string, EntityState>; environment: { global: GlobalEnvironment | null; fields: string[] }; loot: Record<string, LootEntity>; merchant: MerchantState | null; forge: ForgeState | null; forgeUses: Record<string, Record<string, number>>; seen: { hits: Record<string, true>; spawns: Record<string, true> }; message: string };

export type PosePayload = { sequence: number; sentAt: number; position: Vec2; aim: Vec2 };
export type CastRequestPayload = { castId: string; sequence: number; elements: Element[]; aim: Vec2; target: Vec2 };
export type CastAimPayload = { sequence: number; aim: Vec2 };
export type CastReleasePayload = { castId: string };
export type HitRequestPayload = { hitId: string; sourceId: string; targetId: string; tick: number; reason: 'hit' | 'blocked' };
export type ItemActionPayload = { itemId: string };
export type PickupPayload = { lootId: string };
export type MerchantItemPayload = { merchantId: string; itemId: string };
export type ForgeFusePayload = { forgeId: string; itemIds: string[] };
export type HitEvent = { hitId: string; sourceId: string; ownerId?: string; targetId: string; payload: HitPayload; delivery: DeliveryType; detached: boolean; tags: string[] };
export type HitResolution = { accepted: boolean; events: GameEvent[] };
export type GameEvent = { type: 'damage_applied'; targetId: string; amount: number; element: DamageElement } | { type: 'heal_applied'; targetId: string; amount: number } | { type: 'status_applied'; targetId: string; status: ElementStatusType } | { type: 'reaction_triggered'; id: string; targetId: string } | { type: 'cast_started' | 'cast_interrupted'; casterId: string; spellId?: string; reason?: string } | { type: 'entity_spawned' | 'entity_destroyed'; entityId: string };
export type PartiApi = { playerId: string | null; getState(): unknown; onState(handler: (state: unknown) => void): () => void; onEvent(event: string, handler: (payload: unknown) => void): () => void; action(action: string, payload?: unknown): Promise<{ ok: true }>; ready(): void; leave(): void };
declare global { const parti: PartiApi; }
