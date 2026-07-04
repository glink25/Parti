import { WORLD_HEIGHT,WORLD_WIDTH,type MapCorridor,type MapManifest,type MapRoom,type Point } from './contracts';

export const MAP_GENERATION_VERSION=1;
export const PLAYER_RADIUS=24;
const COLS=6,ROWS=5,CELL_W=760,CELL_H=640,ROOM_W=560,ROOM_H=430,ROOM_COUNT=16;

type Cell={x:number;y:number};

export function createRng(seed:number){
 let state=(seed>>>0)||0x6d2b79f5;
 return()=>{state=(state+0x6d2b79f5)|0;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
}

export function generateMap(seed:number):MapManifest{
 const random=createRng(seed),cells:Cell[]=[{x:Math.floor(COLS/2),y:Math.floor(ROWS/2)}],keys=new Set([key(cells[0]!)]),edges:Array<[string,string]>=[];
 while(cells.length<ROOM_COUNT){
  const base=cells[Math.floor(random()*cells.length)]!,directions=shuffle([{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}],random);
  let added=false;
  for(const d of directions){const next={x:base.x+d.x,y:base.y+d.y};if(next.x<0||next.x>=COLS||next.y<0||next.y>=ROWS||keys.has(key(next)))continue;cells.push(next);keys.add(key(next));edges.push([key(base),key(next)]);added=true;break;}
  if(!added&&cells.every(cell=>neighbors(cell).every(n=>n.x<0||n.x>=COLS||n.y<0||n.y>=ROWS||keys.has(key(n)))))break;
 }
 const byCell=new Map<string,MapRoom>();
 const rooms=cells.map((cell,index)=>{const width=ROOM_W+Math.floor(random()*3)*40,height=ROOM_H+Math.floor(random()*3)*35,x=120+cell.x*CELL_W+(CELL_W-width)/2,y=120+cell.y*CELL_H+(CELL_H-height)/2;const room:MapRoom={id:`room-${index}`,gridX:cell.x,gridY:cell.y,x,y,width,height,connections:[]};byCell.set(key(cell),room);return room;});
 // Add a few deterministic loops so exploration is not a single winding tree.
 const edgeKeys=new Set(edges.map(([a,b])=>edgeKey(a,b)));
 const candidates=cells.flatMap(cell=>neighbors(cell).filter(n=>keys.has(key(n))).map(n=>[key(cell),key(n)] as [string,string])).filter(([a,b])=>a<b&&!edgeKeys.has(edgeKey(a,b)));
 for(const edge of shuffle(candidates,random).slice(0,3)){edges.push(edge);edgeKeys.add(edgeKey(...edge));}
 const corridors:MapCorridor[]=edges.map(([a,b],index)=>{const from=byCell.get(a)!,to=byCell.get(b)!;from.connections.push(to.id);to.connections.push(from.id);return corridor(`corridor-${index}`,from,to);});
 const spawnRoom=rooms[0]!;
 return{generationVersion:MAP_GENERATION_VERSION,seed:seed>>>0,width:WORLD_WIDTH,height:WORLD_HEIGHT,spawn:{x:spawnRoom.x+spawnRoom.width/2,y:spawnRoom.y+spawnRoom.height/2},rooms,corridors};
}

export function roomAt(map:MapManifest,p:Point,inset=0){return map.rooms.find(room=>contains(room,p,inset));}
export function isWalkable(map:MapManifest,p:Point,radius=PLAYER_RADIUS){return map.rooms.some(room=>contains(room,p,radius))||map.corridors.some(c=>contains(c,p,radius));}
export function moveWithinMap(map:MapManifest,from:Point,to:Point,radius=PLAYER_RADIUS):Point{
 if(isWalkable(map,to,radius))return to;
 const xOnly={x:to.x,y:from.y};if(isWalkable(map,xOnly,radius))return xOnly;
 const yOnly={x:from.x,y:to.y};if(isWalkable(map,yOnly,radius))return yOnly;
 return{...from};
}
export function mapFingerprint(map:MapManifest){return JSON.stringify({v:map.generationVersion,seed:map.seed,rooms:map.rooms.map(r=>[r.id,r.gridX,r.gridY,r.x,r.y,r.width,r.height,[...r.connections].sort()]),corridors:map.corridors.map(c=>[c.fromRoomId,c.toRoomId,c.x,c.y,c.width,c.height])});}

function corridor(id:string,a:MapRoom,b:MapRoom):MapCorridor{const ac={x:a.x+a.width/2,y:a.y+a.height/2},bc={x:b.x+b.width/2,y:b.y+b.height/2};if(a.gridX!==b.gridX){const left=ac.x<bc.x?a:b,right=left===a?b:a,x=left.x+left.width-70,y=Math.min(ac.y,bc.y)-55;return{id,fromRoomId:a.id,toRoomId:b.id,x,y,width:right.x+70-x,height:110};}const top=ac.y<bc.y?a:b,bottom=top===a?b:a,x=Math.min(ac.x,bc.x)-55,y=top.y+top.height-70;return{id,fromRoomId:a.id,toRoomId:b.id,x,y,width:110,height:bottom.y+70-y};}
function contains(rect:{x:number;y:number;width:number;height:number},p:Point,inset:number){return p.x>=rect.x+inset&&p.x<=rect.x+rect.width-inset&&p.y>=rect.y+inset&&p.y<=rect.y+rect.height-inset;}
function neighbors(c:Cell){return[{x:c.x+1,y:c.y},{x:c.x-1,y:c.y},{x:c.x,y:c.y+1},{x:c.x,y:c.y-1}];}
function key(c:Cell){return`${c.x},${c.y}`;}function edgeKey(a:string,b:string){return a<b?`${a}|${b}`:`${b}|${a}`;}
function shuffle<T>(values:T[],random:()=>number){for(let i=values.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[values[i],values[j]]=[values[j]!,values[i]!];}return values;}
