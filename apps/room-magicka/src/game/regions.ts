import type { MapManifest,RegionEncounter } from './contracts';
import { createRng } from './map';

export function createRegionEncounters(map:MapManifest,partySize:number):RegionEncounter[]{
 const random=createRng(map.seed^0x51f15e),size=Math.max(1,Math.min(4,partySize));
 return map.rooms.slice(1).map((room,index)=>{const sealed=index%4===2||random()<.2,base=sealed?2+size*2:1+Math.floor(random()*2);return{roomId:room.id,kind:sealed?'sealed':'roaming',status:'dormant',enemyCount:base,activatedAt:null,clearedAt:null};});
}

export function activeSimulationRooms(encounters:Iterable<RegionEncounter>,occupied:ReadonlySet<string>){
 const result=new Set(occupied);for(const encounter of encounters)if(encounter.kind==='sealed'&&encounter.status==='active')result.add(encounter.roomId);return result;
}
