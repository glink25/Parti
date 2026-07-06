import { describe, expect, it } from 'vitest';
import type { EquipmentAffix, EquipmentItem, EquipmentSlot, InventoryItem } from '../contracts';
import { applyEquipmentToSpell, canFuse, createCatalyst, createInitialLoot, createMerchant, fuseEquipment, generateEquipment, isCatalyst, isEquipment, isScroll, sellPrice } from './equipment';
import { createScroll, SCROLLS } from './scrolls';
import { resolveSpell } from './spells';

const item = (slot: EquipmentSlot, affixes: EquipmentAffix[] = []): EquipmentItem => ({ id: `test:${slot}:${affixes.length}`, slot, rarity: affixes.length ? 'excellent' : 'normal', name: '测试装备', visualKey: `test.${slot}`, affixes, tags: [slot], description: 'test', value: 40, fusionGeneration: 0, sourceItemValues: [40] });

describe('equipment economy', () => {
  it('generates stable serializable equipment', () => {
    expect(generateEquipment(42, 3)).toEqual(generateEquipment(42, 3));
    expect(generateEquipment(42, 3).id).not.toBe(generateEquipment(42, 4).id);
    expect(() => JSON.stringify(generateEquipment(42, 3))).not.toThrow();
  });

  it('keeps generated affixes inside slot identity', () => {
    for (let i = 0; i < 120; i++) {
      const generated = generateEquipment(11, i);
      for (const affix of generated.affixes) {
        if (generated.slot === 'staff') expect(['elementDamageBonus', 'lifeHealBonus']).toContain(affix.type);
        if (generated.slot === 'robe') expect(['globalDamageReduction', 'elementDamageReduction', 'moveSpeedBonus']).toContain(affix.type);
        if (generated.slot === 'ring') expect(['chantTimeReduction', 'recoveryTimeReduction', 'rangeBonus']).toContain(affix.type);
      }
    }
  });

  it('applies staff and ring effects to spell specs', () => {
    const staff = item('staff', [{ type: 'elementDamageBonus', element: 'fire', value: .5 }]), ring = item('ring', [{ type: 'chantTimeReduction', value: .25 }, { type: 'rangeBonus', delivery: 'projectile', value: .2 }]);
    const spell = applyEquipmentToSpell(resolveSpell(['fire', 'rock']), { staff, ring });
    expect(spell.payload.damage?.fire).toBe(12);
    expect(spell.chantMs).toBeLessThan(resolveSpell(['fire', 'rock']).chantMs);
    expect(spell.range).toBeGreaterThan(resolveSpell(['fire', 'rock']).range);
  });

  it('fuses matching equipment and supports a catalyst', () => {
    const inputs: InventoryItem[] = [item('staff', [{ type: 'elementDamageBonus', element: 'fire', value: .1 }]), item('staff', [{ type: 'elementDamageBonus', element: 'fire', value: .2 }]), item('staff')];
    expect(canFuse(inputs)).toBe(true);
    const result = fuseEquipment(inputs, 5)!;
    expect(result.slot).toBe('staff');
    expect(result.value).toBe(120);
    expect(result.fusionGeneration).toBe(1);
    const catalyst = createCatalyst(7, 'test');
    expect(fuseEquipment([inputs[0]!, inputs[1]!, catalyst], 5)?.affixes.length).toBeGreaterThan(0);
    expect(fuseEquipment([inputs[0]!, item('robe'), catalyst], 5)).toBeNull();
  });

  it('only sells equipment for half value', () => {
    const equipment = item('robe');
    expect(isEquipment(equipment)).toBe(true);
    expect(sellPrice(equipment)).toBe(20);
    expect(sellPrice(createCatalyst(1, 'test'))).toBe(0);
  });

  it('adds scrolls to economy without making them fusion materials', () => {
    const scroll = createScroll('black-hole', 'test');
    expect(isScroll(scroll)).toBe(true);
    expect(sellPrice(scroll)).toBe(Math.floor(scroll.value * .5));
    expect(canFuse([item('staff'), item('staff'), scroll])).toBe(false);
    const merchantStock = createMerchant(7).stock.map((entry) => entry.item), loot = Object.values(createInitialLoot(7)).map((entry) => entry.item);
    for (const scroll of SCROLLS) {
      expect(merchantStock.some((item) => isScroll(item) && item.scrollId === scroll.id)).toBe(true);
      expect(loot.some((item) => isScroll(item) && item.scrollId === scroll.id)).toBe(true);
    }
    expect(merchantStock.filter(isCatalyst)).toHaveLength(3);
    expect(loot.filter(isCatalyst)).toHaveLength(2);
    expect(loot.filter(isEquipment).filter((entry) => entry.rarity === 'rare')).toHaveLength(6);
  });
});
