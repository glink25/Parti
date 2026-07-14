import { describe,expect,it } from 'vitest';
import { generateMap } from './map';
import { activeSimulationRooms,createRegionEncounters,shouldActivateEncounter } from './regions';

describe('region encounters',()=>{
 it('is deterministic and leaves the spawn room safe',()=>{const map=generateMap(123),a=createRegionEncounters(map,2),b=createRegionEncounters(map,2);expect(a).toEqual(b);expect(a).toHaveLength(map.rooms.length-1);expect(a.some(e=>e.kind==='sealed')).toBe(true);expect(a.every(e=>e.roomId!=='room-0')).toBe(true);});
 it('scales sealed encounters with party size',()=>{const map=generateMap(9),solo=createRegionEncounters(map,1),party=createRegionEncounters(map,4);for(const encounter of solo.filter(e=>e.kind==='sealed'))expect(party.find(e=>e.roomId===encounter.roomId)!.enemyCount).toBeGreaterThan(encounter.enemyCount);});
 it('keeps occupied and active sealed rooms simulating',()=>{const encounters=createRegionEncounters(generateMap(3),2),sealed=encounters.find(e=>e.kind==='sealed')!;sealed.status='active';const rooms=activeSimulationRooms(encounters,new Set(['room-1']));expect(rooms.has('room-1')).toBe(true);expect(rooms.has(sealed.roomId)).toBe(true);});
 it('waits for every connected player before activating a sealed room',()=>{const sealed=createRegionEncounters(generateMap(3),2).find(e=>e.kind==='sealed')!;expect(shouldActivateEncounter(sealed,[sealed.roomId,'room-0'])).toBe(false);expect(shouldActivateEncounter(sealed,[sealed.roomId,sealed.roomId])).toBe(true);const roaming={...sealed,kind:'roaming' as const};expect(shouldActivateEncounter(roaming,[roaming.roomId,'room-0'])).toBe(true);});
 it('requires safe interior room ids for sealed activation only',()=>{const sealed=createRegionEncounters(generateMap(3),1).find(e=>e.kind==='sealed')!,roaming={...sealed,kind:'roaming' as const};expect(shouldActivateEncounter(sealed,[sealed.roomId],[null])).toBe(false);expect(shouldActivateEncounter(sealed,[sealed.roomId],[sealed.roomId])).toBe(true);expect(shouldActivateEncounter(roaming,[roaming.roomId],[null])).toBe(true);});
});
