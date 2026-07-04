import { describe,expect,it } from 'vitest'; import { canQueueLightning,reactDamage,resolveSpell } from './spells';
const wet={kind:'wet' as const,intensity:1,stacks:1,sourceId:'rain',expiresAt:999999};
describe('spell resolver',()=>{
 it('prefers ordered exact recipes',()=>{expect(resolveSpell(['fire','life'])?.id).toBe('flame-beam');expect(resolveSpell(['life','fire'])?.id).toBe('mixed:life-fire')});
 it('keeps repeated elements and strengthens fallback spells',()=>{const base=resolveSpell(['rock'])!.effects.find(e=>e.type==='damage')!;const mixed=resolveSpell(['rock','rock'])!.effects.find(e=>e.type==='damage')!;expect(mixed.type==='damage'&&base.type==='damage'&&mixed.amount>base.amount).toBe(true)});
 it('resolves meteor and rain signatures',()=>{expect(resolveSpell(['fire','rock','rock','fire'])?.id).toBe('meteor');expect(resolveSpell(['fire','water','water','fire'])?.delivery).toBe('global')});
 it('applies wet damage reactions',()=>{expect(reactDamage([wet],'fire',20)).toEqual({amount:30,reaction:'蒸发'});expect(reactDamage([wet],'lightning',20).amount).toBe(29)});
 it('requires a queued shield before lightning while wet',()=>{expect(canQueueLightning([], [wet])).toBe(false);expect(canQueueLightning(['shield'],[wet])).toBe(true)});
});
