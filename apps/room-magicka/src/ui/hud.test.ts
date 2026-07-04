import {describe,expect,it} from 'vitest';
import {UiMessageQueue,computeHudLayout,contains,hudBlocksWorld} from './hud';

describe('HUD layout',()=>{
 it.each([[667,375],[844,390],[1280,720],[1920,1080]])('fits a %sx%s viewport with touch-sized elements',(width,height)=>{const layout=computeHudLayout(width,height);expect(layout.minimap.x).toBeGreaterThanOrEqual(0);expect(layout.minimap.y+layout.minimap.h).toBeLessThan(height);expect(layout.elementPanel.y).toBeGreaterThanOrEqual(0);expect(layout.elementCenters).toHaveLength(7);expect(Math.min(...layout.elementCenters.map(button=>button.r*2))).toBeGreaterThanOrEqual(48);expect(layout.status.x+layout.status.w).toBeLessThan(layout.minimap.x);});
 it('blocks world input through every overlay region',()=>{const layout=computeHudLayout(844,390);for(const rect of [layout.status,layout.message,layout.minimap,layout.inventoryButton,layout.spellbookButton,layout.elementPanel])expect(hudBlocksWorld(layout,{x:rect.x+1,y:rect.y+1})).toBe(true);expect(hudBlocksWorld(layout,{x:300,y:180})).toBe(false);expect(contains(layout.minimap,{x:layout.minimap.x,y:layout.minimap.y})).toBe(true);});
});

describe('UI messages',()=>{
 it('prioritizes urgent messages and expires them',()=>{const queue=new UiMessageQueue();queue.push({text:'提示',priority:1,durationMs:5000},100);queue.push({text:'危险',priority:3,durationMs:1000},200);expect(queue.current(300)?.text).toBe('危险');expect(queue.current(1300)?.text).toBe('提示');expect(queue.current(5200)).toBeNull();});
 it('merges repeated keyed events',()=>{const queue=new UiMessageQueue();queue.push({text:'怪物击败',dedupeKey:'kill'},100);queue.push({text:'怪物击败',dedupeKey:'kill'},500);expect(queue.current(600)?.count).toBe(2);});
});
