import {describe,expect,it} from 'vitest';
import {SCROLLS,generateScroll} from './scrolls';

describe('scroll generation',()=>{
 it('is deterministic per seed and source',()=>{expect(generateScroll(42,'boss:0','boss')).toEqual(generateScroll(42,'boss:0','boss'));expect(generateScroll(42,'boss:0','boss')).not.toEqual(generateScroll(42,'boss:1','boss'));});
 it('always gives bosses one configured scroll',()=>{for(let seed=1;seed<30;seed++)expect(SCROLLS.some(v=>v.spellId===generateScroll(seed,'boss','boss')?.spellId)).toBe(true);});
});
