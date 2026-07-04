import { describe,expect,it } from 'vitest';
import { generateMap } from './map';
import { completedSigils,createStageProgress,puzzleRunes,roomDistances } from './progression';

describe('stage progression',()=>{
 it('places three distinct objectives away from the spawn and reserves the farthest room for the boss',()=>{const map=generateMap(44),stage=createStageProgress(map,0),ids=stage.objectives.map(o=>o.roomId),distances=roomDistances(map,'room-0');expect(new Set(ids).size).toBe(3);expect(ids).not.toContain('room-0');expect(ids).not.toContain(stage.boss.roomId);expect(distances.get(stage.boss.roomId)).toBe(Math.max(...distances.values()));expect(stage.objectives.map(o=>o.kind)).toEqual(['elite','altar','puzzle']);});
 it('requires two completed objectives',()=>{const stage=createStageProgress(generateMap(8),0);expect(completedSigils(stage)).toBe(0);stage.objectives[0]!.status='completed';stage.objectives[1]!.status='completed';expect(completedSigils(stage)).toBe(stage.requiredSigils);});
 it('places all puzzle runes inside their objective room',()=>{const map=generateMap(9),stage=createStageProgress(map,0),objective=stage.objectives.find(o=>o.kind==='puzzle')!,room=map.rooms.find(r=>r.id===objective.roomId)!;for(const rune of puzzleRunes(map,room.id)){expect(rune.x).toBeGreaterThan(room.x);expect(rune.x).toBeLessThan(room.x+room.width);expect(rune.y).toBeGreaterThan(room.y);expect(rune.y).toBeLessThan(room.y+room.height);}});
});
