import type { CatalystItem, DamageElement, Element, EquipmentAffix, EquipmentItem, EquipmentSlot, ForgeState, InventoryItem, MerchantState, PlayerEquipment, ScrollId, SpellSpec, Vec2 } from '../contracts';
import { createScroll, isScroll } from './scrolls';

const ELEMENT_NAMES: Record<Element, string> = { rock: '岩', fire: '火', ice: '冰', life: '生命', lightning: '雷', water: '水', shield: '盾' };
const SLOT_NAMES: Record<EquipmentSlot, string> = { staff: '法杖', robe: '法袍', ring: '法戒' };
const NON_SHIELD_ELEMENTS: Array<Exclude<Element, 'shield'>> = ['rock', 'fire', 'ice', 'life', 'lightning', 'water'];
const DAMAGE_ELEMENTS: DamageElement[] = ['physical', 'rock', 'fire', 'ice', 'life', 'lightning', 'water', 'shield', 'pure'];
const TEST_SCROLLS: ScrollId[] = ['supernova', 'equilibrium', 'annihilation', 'black-hole'];

type Prototype = { slot: EquipmentSlot; name: string; visualKey: string; tags: string[]; description: string };

const PROTOTYPES: Prototype[] = [
  { slot: 'staff', name: '焦黑橡木法杖', visualKey: 'staff.charred_oak', tags: ['staff', 'fire'], description: '适合测试元素伤害加成的训练法杖。' },
  { slot: 'staff', name: '雷纹白蜡法杖', visualKey: 'staff.storm_ash', tags: ['staff', 'lightning'], description: '导引雷元素，让感电和打断更容易观察。' },
  { slot: 'staff', name: '活根法杖', visualKey: 'staff.living_root', tags: ['staff', 'life'], description: '强化生命元素治疗，适合多人配合。' },
  { slot: 'robe', name: '踏霜法袍', visualKey: 'robe.frostwalker', tags: ['robe', 'ice'], description: '轻便的防护法袍，兼顾减伤和移动。' },
  { slot: 'robe', name: '守誓法袍', visualKey: 'robe.oathguard', tags: ['robe', 'defense'], description: '朴素结实的训练法袍。' },
  { slot: 'ring', name: '扩域法戒', visualKey: 'ring.widecast', tags: ['ring', 'range'], description: '让法术影响范围更容易被看见。' },
  { slot: 'ring', name: '疾咏法戒', visualKey: 'ring.quickchant', tags: ['ring', 'cast'], description: '缩短施法节奏，方便连续测试技能。' },
];

function rng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ value >>> 15, 2246822507);
    value = Math.imul(value ^ value >>> 13, 3266489909);
    value ^= value >>> 16;
    return (value >>> 0) / 0xffffffff;
  };
}

function hashText(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomAffix(slot: EquipmentSlot, random: () => number): EquipmentAffix {
  const value = 0.08 + Math.round(random() * 10) / 100;
  if (slot === 'staff') {
    const element = NON_SHIELD_ELEMENTS[Math.floor(random() * NON_SHIELD_ELEMENTS.length)]!;
    return element === 'life' ? { type: 'lifeHealBonus', value } : { type: 'elementDamageBonus', element, value };
  }
  if (slot === 'robe') {
    const roll = random();
    if (roll < .35) return { type: 'moveSpeedBonus', value: value * .75 };
    if (roll < .7) return { type: 'globalDamageReduction', value: value * .7 };
    return { type: 'elementDamageReduction', element: DAMAGE_ELEMENTS[Math.floor(random() * DAMAGE_ELEMENTS.length)]!, value };
  }
  const roll = random();
  if (roll < .34) return { type: 'chantTimeReduction', value: value * .75 };
  if (roll < .67) return { type: 'recoveryTimeReduction', value: value * .75 };
  const deliveries: Array<Extract<EquipmentAffix, { type: 'rangeBonus' }>['delivery']> = ['spray', 'beam', 'projectile', 'area', 'summon'];
  return { type: 'rangeBonus', delivery: deliveries[Math.floor(random() * deliveries.length)]!, value };
}

export function isCatalyst(item: InventoryItem | undefined): item is CatalystItem {
  return Boolean(item && 'kind' in item && item.kind === 'catalyst');
}

export function isEquipment(item: InventoryItem | undefined): item is EquipmentItem {
  return Boolean(item && !('kind' in item));
}

export { isScroll };

export function createCatalyst(seed: number, source: string): CatalystItem {
  return { id: `orb:${seed.toString(36)}:${source}`, kind: 'catalyst', name: '合成宝珠', description: '可替代第三件同类装备，使合成保留更多词缀。', value: 80 };
}

export function generateEquipment(seed: number, index: number): EquipmentItem {
  const random = rng((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0), prototype = PROTOTYPES[Math.floor(random() * PROTOTYPES.length)]!, rarityRoll = random();
  const rarity = rarityRoll > .82 ? 'rare' : rarityRoll > .45 ? 'excellent' : 'normal', affixCount = rarity === 'rare' ? 2 : rarity === 'excellent' ? 1 : 0;
  const affixes: EquipmentAffix[] = [];
  for (let i = 0; i < affixCount; i++) {
    const affix = randomAffix(prototype.slot, random);
    if (!affixes.some((existing) => affixKey(existing) === affixKey(affix))) affixes.push(affix);
  }
  const value = rarity === 'rare' ? 110 : rarity === 'excellent' ? 70 : 40;
  return { id: `item:${seed.toString(36)}:${index}`, slot: prototype.slot, rarity, name: prototype.name, visualKey: prototype.visualKey, affixes, tags: [...prototype.tags, rarity], description: prototype.description, value, fusionGeneration: 0, sourceItemValues: [value] };
}

function trainingEquipment(seed: number, index: number, slot: EquipmentSlot): EquipmentItem {
  const base = generateEquipment(seed ^ 0x74726169, index);
  const element = NON_SHIELD_ELEMENTS[index % NON_SHIELD_ELEMENTS.length]!;
  const backupElement: Exclude<Element, 'life' | 'shield'> = element === 'fire' ? 'lightning' : 'fire';
  const affixes: EquipmentAffix[] = slot === 'staff'
    ? element === 'life' ? [{ type: 'lifeHealBonus', value: .45 }, { type: 'elementDamageBonus', element: backupElement, value: .3 }] : [{ type: 'elementDamageBonus', element, value: .45 }, { type: 'elementDamageBonus', element: backupElement, value: .3 }]
    : slot === 'robe'
      ? [{ type: 'globalDamageReduction', value: .28 }, { type: 'moveSpeedBonus', value: .22 }]
      : [{ type: 'chantTimeReduction', value: .3 }, { type: 'recoveryTimeReduction', value: .3 }, { type: 'rangeBonus', delivery: 'beam', value: .28 }];
  return { ...base, id: `test:${seed.toString(36)}:${slot}:${index}`, slot, rarity: 'rare', name: `试炼${SLOT_NAMES[slot]} ${index + 1}`, affixes, tags: [slot, 'test', 'rare'], description: '测试阶段投放的高强度装备，便于快速验证战斗、合成与数值反馈。', value: 220, fusionGeneration: 0, sourceItemValues: [220] };
}

export function createMerchant(seed: number): MerchantState {
  const slots: EquipmentSlot[] = ['staff', 'staff', 'staff', 'robe', 'robe', 'ring', 'ring'];
  const stock: MerchantState['stock'] = slots.map((slot, index) => {
    const item = trainingEquipment(seed ^ 0x6d657263, index + 10, slot);
    return { item, price: Math.floor(item.value * .6) };
  });
  for (let i = 0; i < 3; i++) stock.push({ item: createCatalyst(seed + i, `merchant:${i}`), price: 40 });
  for (const id of TEST_SCROLLS) stock.push({ item: createScroll(id, `merchant:${seed}`), price: Math.floor((createScroll(id, 'price').value) * .6) });
  return { id: 'merchant:wandering', position: { x: 760, y: 200 }, radius: 56, stock };
}

export function createForge(): ForgeState {
  return { id: 'forge:training', position: { x: 300, y: 190 }, radius: 64 };
}

export function createInitialLoot(seed: number) {
  const slots: EquipmentSlot[] = ['staff', 'staff', 'staff', 'robe', 'ring', 'ring'];
  const entries: Array<[string, { id: string; position: Vec2; item: InventoryItem; droppedByPlayerId: null; ownerPriorityUntil: number }]> = slots.map((slot, index) => {
    const item = trainingEquipment(seed ^ 0x6c6f6f74, index, slot);
    return [`loot:${index}`, { id: `loot:${index}`, position: { x: 330 + index % 3 * 72, y: 410 + Math.floor(index / 3) * 58 }, item, droppedByPlayerId: null, ownerPriorityUntil: 0 }];
  });
  entries.push(['loot:orb:0', { id: 'loot:orb:0', position: { x: 570, y: 410 }, item: createCatalyst(seed, 'loot:0'), droppedByPlayerId: null, ownerPriorityUntil: 0 }]);
  entries.push(['loot:orb:1', { id: 'loot:orb:1', position: { x: 642, y: 410 }, item: createCatalyst(seed + 1, 'loot:1'), droppedByPlayerId: null, ownerPriorityUntil: 0 }]);
  for (const [index, id] of TEST_SCROLLS.entries()) entries.push([`loot:scroll:${id}`, { id: `loot:scroll:${id}`, position: { x: 534 + index * 66, y: 482 }, item: createScroll(id, `loot:${seed}`), droppedByPlayerId: null, ownerPriorityUntil: 0 }]);
  return Object.fromEntries(entries);
}

export function sellPrice(item: InventoryItem) {
  return isEquipment(item) || isScroll(item) ? Math.floor(item.value * .5) : 0;
}

export function fusionPrice(uses: number) {
  return (uses + 1) * 50;
}

export function canFuse(items: readonly InventoryItem[]) {
  const equipment = items.filter(isEquipment), catalysts = items.filter(isCatalyst);
  return items.length === 3 && ((equipment.length === 3 && catalysts.length === 0) || (equipment.length === 2 && catalysts.length === 1)) && new Set(equipment.map((item) => item.slot)).size === 1;
}

export function fuseEquipment(items: readonly InventoryItem[], seed: number): EquipmentItem | null {
  if (!canFuse(items)) return null;
  const equipment = items.filter(isEquipment), stabilized = items.some(isCatalyst), first = equipment[0]!, sourceAffixes = equipment.flatMap((item) => item.affixes), legal: EquipmentAffix[] = [];
  for (const affix of sourceAffixes) {
    const existing = legal.find((value) => affixKey(value) === affixKey(affix));
    if (!existing) legal.push({ ...affix });
    else if ('value' in existing) existing.value = Math.max(existing.value, affix.value);
  }
  const random = rng(seed), kept = legal.filter(() => stabilized || random() < .7).slice(0, 3);
  if (!kept.length && legal.length) kept.push(legal[Math.floor(random() * legal.length)]!);
  const value = equipment.reduce((sum, item) => sum + item.value, 0), generation = Math.max(...equipment.map((item) => item.fusionGeneration)) + 1;
  return { id: `fusion:${(seed >>> 0).toString(36)}:${generation}`, slot: first.slot, rarity: equipment.some((item) => item.rarity === 'rare') ? 'rare' : 'excellent', name: `熔铸${first.name}`, visualKey: first.visualKey, affixes: kept, tags: [first.slot, 'fusion'], description: stabilized ? '由两件装备与合成宝珠稳定合成。' : '由三件同类型装备合成。', value, fusionGeneration: generation, sourceItemValues: equipment.flatMap((item) => item.sourceItemValues) };
}

export function affixText(affix: EquipmentAffix) {
  if (affix.type === 'elementDamageBonus') return `${ELEMENT_NAMES[affix.element]}伤害 +${Math.round(affix.value * 100)}%`;
  if (affix.type === 'lifeHealBonus') return `生命治疗 +${Math.round(affix.value * 100)}%`;
  if (affix.type === 'globalDamageReduction') return `受到伤害 -${Math.round(affix.value * 100)}%`;
  if (affix.type === 'elementDamageReduction') return `${ELEMENT_NAMES[affix.element as Element] ?? affix.element}伤害减免 ${Math.round(affix.value * 100)}%`;
  if (affix.type === 'moveSpeedBonus') return `移动速度 +${Math.round(affix.value * 100)}%`;
  if (affix.type === 'chantTimeReduction') return `吟唱时间 -${Math.round(affix.value * 100)}%`;
  if (affix.type === 'recoveryTimeReduction') return `后摇时间 -${Math.round(affix.value * 100)}%`;
  return `${affix.delivery} 范围 +${Math.round(affix.value * 100)}%`;
}

export function itemTypeText(item: InventoryItem) {
  if (isCatalyst(item)) return '合成宝珠';
  if (isScroll(item)) return '卷轴';
  return `${SLOT_NAMES[item.slot]} · ${{ normal: '普通', excellent: '优秀', rare: '稀有' }[item.rarity]}`;
}

export function itemDetailLines(item: InventoryItem) {
  if (isScroll(item)) return [`组合：${item.elements.map((element) => ELEMENT_NAMES[element]).join('·')}`, `冷却：${Math.round(item.cooldownMs / 1000)} 秒`, item.description];
  return isEquipment(item) ? (item.affixes.length ? item.affixes.map(affixText) : ['无属性词缀']) : [item.description];
}

export function applyEquipmentToSpell(spell: SpellSpec, equipment: PlayerEquipment): SpellSpec {
  const result = structuredClone(spell) as SpellSpec;
  for (const item of Object.values(equipment)) {
    if (!item) continue;
    for (const affix of item.affixes) {
      if (item.slot === 'staff' && affix.type === 'elementDamageBonus' && result.payload.damage?.[affix.element]) result.payload.damage[affix.element]! *= 1 + affix.value;
      else if (item.slot === 'staff' && affix.type === 'lifeHealBonus' && result.payload.heal && result.elements.includes('life')) result.payload.heal *= 1 + affix.value;
      else if (item.slot === 'ring' && affix.type === 'chantTimeReduction') result.chantMs = Math.max(60, Math.round(result.chantMs * (1 - affix.value)));
      else if (item.slot === 'ring' && affix.type === 'recoveryTimeReduction') result.recoveryMs = Math.max(80, Math.round(result.recoveryMs * (1 - affix.value)));
      else if (item.slot === 'ring' && affix.type === 'rangeBonus' && result.delivery === affix.delivery) {
        result.range = Math.round(result.range * (1 + affix.value));
        result.radius = Math.round(result.radius * (1 + affix.value));
      }
    }
  }
  return result;
}

export function damageMultiplier(equipment: PlayerEquipment, element: DamageElement) {
  let result = 1;
  for (const item of Object.values(equipment)) if (item?.slot === 'robe') for (const affix of item.affixes) {
    if (affix.type === 'globalDamageReduction') result *= 1 - affix.value;
    else if (affix.type === 'elementDamageReduction' && affix.element === element) result *= 1 - affix.value;
  }
  return Math.max(.35, result);
}

export function moveSpeedMultiplier(equipment: PlayerEquipment) {
  let bonus = 0;
  for (const item of Object.values(equipment)) if (item?.slot === 'robe') for (const affix of item.affixes) if (affix.type === 'moveSpeedBonus') bonus += affix.value;
  return 1 + Math.min(.45, bonus);
}

export function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function fusionSeed(seed: number, playerId: string, ids: readonly string[], uses: number) {
  return (seed ^ hashText(`${playerId}:${ids.join(':')}:${uses}`)) >>> 0;
}

function affixKey(affix: EquipmentAffix) {
  return `${affix.type}:${'element' in affix ? affix.element : ''}:${'delivery' in affix ? affix.delivery : ''}`;
}
