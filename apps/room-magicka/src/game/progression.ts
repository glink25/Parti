import type { MapManifest,StageProgress } from './contracts';

export function createStageProgress(map:MapManifest,index:number):StageProgress{
 const distances=roomDistances(map,'room-0'),ranked=map.rooms.slice(1).sort((a,b)=>(distances.get(b.id)??0)-(distances.get(a.id)??0)||a.id.localeCompare(b.id)),large=ranked.filter(room=>room.gridWidth*room.gridHeight>1),bossRoom=large[0]??ranked[0]!,used=new Set([bossRoom.id]),take=(preferLarge:boolean)=>{const room=(preferLarge?large:ranked).find(candidate=>!used.has(candidate.id))??ranked.find(candidate=>!used.has(candidate.id))!;used.add(room.id);return room;},objectiveRooms=[take(true),take(true),take(false)],kinds=['elite','altar','puzzle'] as const;
 return{index,requiredSigils:2,objectives:objectiveRooms.map((room,i)=>({id:`objective-${index}-${kinds[i]}`,roomId:room.id,kind:kinds[i]!,status:'dormant',progress:0,target:kinds[i]==='altar'?2:kinds[i]==='puzzle'?3:1,startedAt:null})),boss:{roomId:bossRoom.id,status:'locked',enemyId:null,phase:0,nextMechanicAt:0},portal:null};
}

export function completedSigils(stage:StageProgress){return stage.objectives.filter(o=>o.status==='completed').length;}
export function roomDistances(map:MapManifest,startId:string){const result=new Map<string,number>([[startId,0]]),queue=[startId];while(queue.length){const id=queue.shift()!,room=map.rooms.find(r=>r.id===id);if(!room)continue;for(const next of room.connections)if(!result.has(next)){result.set(next,result.get(id)!+1);queue.push(next);}}return result;}
export function puzzleRunes(map:MapManifest,roomId:string){const room=map.rooms.find(r=>r.id===roomId);if(!room)return[];return[-1,0,1].map((offset,index)=>({index,x:room.x+room.width/2+offset*room.width*.25,y:room.y+room.height/2+(index%2?room.height*.18:-room.height*.18)}));}
