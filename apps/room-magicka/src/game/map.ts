import { WORLD_HEIGHT,WORLD_WIDTH,type MapCorridor,type MapManifest,type MapRoom,type Point,type RoomTemplateKind } from './contracts';

export const MAP_GENERATION_VERSION=2;
export const PLAYER_RADIUS=24;
const COLS=6,ROWS=5,CELL_W=1250,CELL_H=950,MARGIN_X=150,MARGIN_Y=150,ROOM_COUNT=14;
type Placement={gridX:number;gridY:number;gridWidth:number;gridHeight:number;templateKind:RoomTemplateKind;neighborIds:string[]};

export function createRng(seed:number){let state=(seed>>>0)||0x6d2b79f5;return()=>{state=(state+0x6d2b79f5)|0;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

export function generateMap(seed:number):MapManifest{
 const random=createRng(seed),rooms:MapRoom[]=[makeRoom('room-0',{gridX:2,gridY:2,gridWidth:1,gridHeight:1,templateKind:'standard',neighborIds:[]},random)],occupied=new Map<string,string>([[cellKey(2,2),'room-0']]),edges:Array<[string,string]>=[];
 const preferred:RoomTemplateKind[]=['standard','standard','wide','tall','wide','tall','wide','tall','standard','standard','standard','standard','standard'];
 for(let index=1;index<ROOM_COUNT;index++){
  const kind=preferred[index-1]!,placements=findPlacements(kind,occupied);let candidates=placements;
  if(!candidates.length)candidates=findPlacements('standard',occupied);
  if(!candidates.length)throw new Error('Unable to place connected map room');
  const placement=candidates[Math.floor(random()*candidates.length)]!,id=`room-${index}`,room=makeRoom(id,placement,random);rooms.push(room);for(let y=placement.gridY;y<placement.gridY+placement.gridHeight;y++)for(let x=placement.gridX;x<placement.gridX+placement.gridWidth;x++)occupied.set(cellKey(x,y),id);const neighbor=placement.neighborIds[Math.floor(random()*placement.neighborIds.length)]!;edges.push([neighbor,id]);
 }
 const existing=new Set(edges.map(([a,b])=>edgeKey(a,b))),loopCandidates: Array<[string,string]>=[];
 for(const room of rooms)for(const other of rooms)if(room.id<other.id&&touches(room,other)&&!existing.has(edgeKey(room.id,other.id)))loopCandidates.push([room.id,other.id]);
 for(const edge of shuffle(loopCandidates,random).slice(0,3)){edges.push(edge);existing.add(edgeKey(...edge));}
 const byId=new Map(rooms.map(room=>[room.id,room])),corridors:MapCorridor[]=edges.map(([a,b],index)=>{const from=byId.get(a)!,to=byId.get(b)!;from.connections.push(to.id);to.connections.push(from.id);return corridor(`corridor-${index}`,from,to);});
 const spawnRoom=rooms[0]!;return{generationVersion:MAP_GENERATION_VERSION,seed:seed>>>0,width:WORLD_WIDTH,height:WORLD_HEIGHT,spawn:center(spawnRoom),rooms,corridors};
}

export function roomAt(map:MapManifest,p:Point,inset=0){return map.rooms.find(room=>contains(room,p,inset));}
export function isWalkable(map:MapManifest,p:Point,radius=PLAYER_RADIUS){return map.rooms.some(room=>contains(room,p,radius))||map.corridors.some(c=>contains(c,p,radius));}
export function moveWithinMap(map:MapManifest,from:Point,to:Point,radius=PLAYER_RADIUS):Point{if(isWalkable(map,to,radius))return to;const xOnly={x:to.x,y:from.y};if(isWalkable(map,xOnly,radius))return xOnly;const yOnly={x:from.x,y:to.y};if(isWalkable(map,yOnly,radius))return yOnly;return{...from};}
export function mapFingerprint(map:MapManifest){return JSON.stringify({v:map.generationVersion,seed:map.seed,rooms:map.rooms.map(r=>[r.id,r.gridX,r.gridY,r.gridWidth,r.gridHeight,r.templateKind,r.x,r.y,r.width,r.height,[...r.connections].sort()]),corridors:map.corridors.map(c=>[c.fromRoomId,c.toRoomId,c.x,c.y,c.width,c.height])});}

function findPlacements(kind:RoomTemplateKind,occupied:Map<string,string>):Placement[]{const [gridWidth,gridHeight]=kind==='wide'?[2,1]:kind==='tall'?[1,2]:[1,1],result:Placement[]=[];for(let gridY=0;gridY<=ROWS-gridHeight;gridY++)for(let gridX=0;gridX<=COLS-gridWidth;gridX++){let free=true;const neighbors=new Set<string>();for(let y=gridY;y<gridY+gridHeight;y++)for(let x=gridX;x<gridX+gridWidth;x++){if(occupied.has(cellKey(x,y)))free=false;for(const n of cellNeighbors(x,y)){const id=occupied.get(cellKey(n.x,n.y));if(id)neighbors.add(id);}}if(free&&neighbors.size)result.push({gridX,gridY,gridWidth,gridHeight,templateKind:kind,neighborIds:[...neighbors]});}return result;}
function makeRoom(id:string,p:Placement,random:()=>number):MapRoom{const width=p.templateKind==='wide'?2000+Math.floor(random()*6)*50:900+Math.floor(random()*5)*50,height=p.templateKind==='tall'?1600+Math.floor(random()*4)*50:650+Math.floor(random()*4)*50,footprintW=p.gridWidth*CELL_W,footprintH=p.gridHeight*CELL_H,x=MARGIN_X+p.gridX*CELL_W+(footprintW-width)/2,y=MARGIN_Y+p.gridY*CELL_H+(footprintH-height)/2;return{id,gridX:p.gridX,gridY:p.gridY,gridWidth:p.gridWidth,gridHeight:p.gridHeight,templateKind:p.templateKind,x,y,width,height,connections:[]};}
function corridor(id:string,a:MapRoom,b:MapRoom):MapCorridor{const overlapRows={start:Math.max(a.gridY,b.gridY),end:Math.min(a.gridY+a.gridHeight,b.gridY+b.gridHeight)},overlapCols={start:Math.max(a.gridX,b.gridX),end:Math.min(a.gridX+a.gridWidth,b.gridX+b.gridWidth)};if(a.gridX+a.gridWidth===b.gridX||b.gridX+b.gridWidth===a.gridX){const left=a.gridX<b.gridX?a:b,right=left===a?b:a,doorY=MARGIN_Y+(overlapRows.start+(overlapRows.end-overlapRows.start)/2)*CELL_H,x=left.x+left.width-70,y=doorY-60;return{id,fromRoomId:a.id,toRoomId:b.id,x,y,width:right.x+70-x,height:120};}const top=a.gridY<b.gridY?a:b,bottom=top===a?b:a,doorX=MARGIN_X+(overlapCols.start+(overlapCols.end-overlapCols.start)/2)*CELL_W,x=doorX-60,y=top.y+top.height-70;return{id,fromRoomId:a.id,toRoomId:b.id,x,y,width:120,height:bottom.y+70-y};}
function touches(a:MapRoom,b:MapRoom){const rowOverlap=Math.max(a.gridY,b.gridY)<Math.min(a.gridY+a.gridHeight,b.gridY+b.gridHeight),colOverlap=Math.max(a.gridX,b.gridX)<Math.min(a.gridX+a.gridWidth,b.gridX+b.gridWidth);return(rowOverlap&&(a.gridX+a.gridWidth===b.gridX||b.gridX+b.gridWidth===a.gridX))||(colOverlap&&(a.gridY+a.gridHeight===b.gridY||b.gridY+b.gridHeight===a.gridY));}
function center(room:MapRoom){return{x:room.x+room.width/2,y:room.y+room.height/2};}function contains(rect:{x:number;y:number;width:number;height:number},p:Point,inset:number){return p.x>=rect.x+inset&&p.x<=rect.x+rect.width-inset&&p.y>=rect.y+inset&&p.y<=rect.y+rect.height-inset;}
function cellNeighbors(x:number,y:number){return[{x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1}];}function cellKey(x:number,y:number){return`${x},${y}`;}function edgeKey(a:string,b:string){return a<b?`${a}|${b}`:`${b}|${a}`;}
function shuffle<T>(values:T[],random:()=>number){for(let i=values.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[values[i],values[j]]=[values[j]!,values[i]!];}return values;}
