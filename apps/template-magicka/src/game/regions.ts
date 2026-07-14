import type { MapManifest,RegionEncounter } from './contracts';
import { createRng } from './map';

export function createRegionEncounters(map:MapManifest,partySize:number):RegionEncounter[]{
 const random=createRng(map.stageSeed^0x51f15e),bossHasChallenge=createRng(map.stageSeed^0x6368616c)()<.35,size=Math.max(1,Math.min(4,partySize)),elements=['rock','fire','ice','life','lightning','water'] as const;let challengeUsed=false;
 return map.rooms.slice(1).map((room,index)=>{const sealed=index%4===2||random()<.2,base=sealed?2+size*2:1+Math.floor(random()*2),challenged=!bossHasChallenge&&sealed&&!challengeUsed&&random()<.2;if(challenged)challengeUsed=true;return{roomId:room.id,kind:sealed?'sealed':'roaming',status:'dormant',enemyCount:base,activatedAt:null,clearedAt:null,challenge:challenged?{element:elements[Math.floor(random()*elements.length)]!,active:false}:null};});
}

export function activeSimulationRooms(encounters:Iterable<RegionEncounter>,occupied:ReadonlySet<string>){
 const result=new Set(occupied);for(const encounter of encounters)if(encounter.kind==='sealed'&&encounter.status==='active')result.add(encounter.roomId);return result;
}

export function shouldActivateEncounter(encounter:RegionEncounter,playerRoomIds:readonly (string|null)[],sealedRoomIds:readonly (string|null)[]=playerRoomIds){
 if(encounter.status!=='dormant'||!playerRoomIds.length)return false;
 return encounter.kind==='sealed'?sealedRoomIds.length>0&&sealedRoomIds.every(roomId=>roomId===encounter.roomId):playerRoomIds.some(roomId=>roomId===encounter.roomId);
}
