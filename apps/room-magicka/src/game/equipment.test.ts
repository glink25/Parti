import { describe,expect,it } from 'vitest';
import { canEquip,createMerchant,equipmentBonuses,generateEquipment } from './equipment';
import { generateMap } from './map';

describe('equipment economy',()=>{
 it('generates stable item prototypes and affixes from a seed',()=>{expect(generateEquipment(42,3)).toEqual(generateEquipment(42,3));expect(generateEquipment(42,3).id).not.toBe(generateEquipment(42,4).id);});
 it('combines equipped item bonuses',()=>{const staff=generateEquipment(4,0),robe={...generateEquipment(5,0),slot:'robe' as const,stats:{spellPower:0,castSpeed:0,damageReduction:.2,moveSpeed:.1}},bonuses=equipmentBonuses({staff,robe,ring:null});expect(bonuses.spellPower).toBe(staff.stats.spellPower);expect(bonuses.damageReduction).toBe(Math.round((staff.stats.damageReduction+.2)*1000)/1000);expect(bonuses.moveSpeed).toBe(Math.round((staff.stats.moveSpeed+.1)*1000)/1000);});
 it('creates deterministic merchant stock and checks inventory ownership',()=>{const merchant=createMerchant(generateMap(7),0);expect(merchant.stock).toHaveLength(3);expect(createMerchant(generateMap(7),0)).toEqual(merchant);expect(canEquip([merchant.stock[0]!.item],merchant.stock[0]!.item.id)).toBe(true);});
});
