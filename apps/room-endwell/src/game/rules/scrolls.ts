import { annihilationSpec, blackHoleSpec, equilibriumSpec, supernovaSpec } from '../../content/spells';
import type { Element, PlayerState, ScrollId, ScrollItem, SpellSpec } from '../contracts';

export const SCROLL_COOLDOWN_MS = 20_000;

type ScrollDefinition = {
  id: ScrollId;
  name: string;
  elements: Element[];
  description: string;
  value: number;
  cooldownMs: number;
  spec: (elements: Element[]) => SpellSpec;
};

type ReadyScroll = { definition: ScrollDefinition; item: ScrollItem };

export const SCROLLS: readonly ScrollDefinition[] = [
  { id: 'supernova', name: '超新星爆发卷轴', elements: ['lightning', 'life', 'shield', 'fire'], description: '解锁超新星爆发：全场存活实体损失 50% 当前生命。', value: 180, cooldownMs: SCROLL_COOLDOWN_MS, spec: supernovaSpec },
  { id: 'equilibrium', name: '均衡术卷轴', elements: ['rock', 'shield', 'ice', 'life'], description: '解锁均衡术：全场存活实体生命调整为 50% 最大生命。', value: 160, cooldownMs: SCROLL_COOLDOWN_MS, spec: equilibriumSpec },
  { id: 'annihilation', name: '湮灭术卷轴', elements: ['rock', 'ice', 'life'], description: '解锁湮灭术：定点范围内恰好一个目标时损失 99% 当前生命。', value: 220, cooldownMs: SCROLL_COOLDOWN_MS, spec: annihilationSpec },
  { id: 'black-hole', name: '黑洞卷轴', elements: ['shield', 'rock', 'rock', 'shield'], description: '解锁黑洞：落点生成长时间无差别伤害场。', value: 200, cooldownMs: SCROLL_COOLDOWN_MS, spec: blackHoleSpec },
];

const sameElements = (left: readonly Element[], right: readonly Element[]) => left.length === right.length && right.every((element, index) => left[index] === element);

export function scrollDefinition(id: ScrollId) {
  return SCROLLS.find((scroll) => scroll.id === id);
}

export function createScroll(id: ScrollId, source = 'generated'): ScrollItem {
  const definition = scrollDefinition(id);
  if (!definition) throw new Error(`Unknown scroll: ${id}`);
  return { id: `scroll:${id}:${source}`, kind: 'scroll', scrollId: id, name: definition.name, description: definition.description, value: definition.value, elements: [...definition.elements], cooldownMs: definition.cooldownMs, visualKey: `scroll.${id}`, tags: ['scroll', id] };
}

export function isScroll(item: unknown): item is ScrollItem {
  return Boolean(item && typeof item === 'object' && (item as ScrollItem).kind === 'scroll');
}

export function scrollForElements(elements: readonly Element[]) {
  return SCROLLS.find((scroll) => sameElements(elements, scroll.elements));
}

export function ownedReadyScrollFor(elements: readonly Element[], player: PlayerState, now: number): ReadyScroll | null {
  const definition = scrollForElements(elements);
  if (!definition) return null;
  const item = player.inventory.find((entry): entry is ScrollItem => isScroll(entry) && entry.scrollId === definition.id);
  if (!item || (player.scrollCooldowns[definition.id] ?? 0) > now) return null;
  return { definition, item };
}

export function resolveScrollSpell(elements: Element[], player: PlayerState, now: number): SpellSpec | null {
  const owned = ownedReadyScrollFor(elements, player, now);
  return owned ? owned.definition.spec(elements) : null;
}
