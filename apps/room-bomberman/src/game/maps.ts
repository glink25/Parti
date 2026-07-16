export interface ArenaMap { id: string; name: string; theme: 'garden'|'frost'|'volcano'|'neon'; rows: string[]; spawns: Array<{x:number;y:number}> }

export const MAP_WIDTH = 19;
export const MAP_HEIGHT = 15;

const spawns = [{x:1,y:1},{x:17,y:1},{x:1,y:13},{x:17,y:13}];
const safeCells=new Set(spawns.flatMap(({x,y})=>[[x,y],[x-1,y],[x+1,y],[x,y-1],[x,y+1]]).map(([x,y])=>`${x},${y}`));

function arena(brickAt:(x:number,y:number)=>boolean) {
  return Array.from({length:MAP_HEIGHT},(_,y)=>Array.from({length:MAP_WIDTH},(_,x)=>{
    if(x===0||y===0||x===MAP_WIDTH-1||y===MAP_HEIGHT-1)return '#';
    if(x%2===0&&y%2===0)return '#';
    if(safeCells.has(`${x},${y}`))return '.';
    return brickAt(x,y)?'+':'.';
  }).join(''));
}

const dense=(seed:number,x:number,y:number)=>((x*17+y*29+seed*13+x*y*3)%11)<7;

export const MAPS: ArenaMap[] = [
  {id:'garden-cross',name:'苔庭十字',theme:'garden',spawns,rows:arena((x,y)=>x!==9&&y!==7&&dense(1,x,y))},
  {id:'garden-court',name:'藤蔓庭院',theme:'garden',spawns,rows:arena((x,y)=>!(x>=7&&x<=11&&y>=5&&y<=9)&&dense(2,x,y))},
  {id:'frost-bridge',name:'霜桥',theme:'frost',spawns,rows:arena((x,y)=>y!==7&&!(x===5||x===13)&&dense(3,x,y))},
  {id:'frost-vault',name:'冰晶穹窟',theme:'frost',spawns,rows:arena((x,y)=>!(x>=7&&x<=11&&y>=5&&y<=9)&&((x+y)%4!==0||dense(4,x,y)))},
  {id:'volcano-core',name:'熔火核心',theme:'volcano',spawns,rows:arena((x,y)=>!(Math.abs(x-9)<=2&&Math.abs(y-7)<=2)&&dense(5,x,y))},
  {id:'volcano-rift',name:'赤红裂谷',theme:'volcano',spawns,rows:arena((x,y)=>x!==y+2&&x!==16-y&&dense(6,x,y))},
  {id:'neon-grid',name:'霓虹矩阵',theme:'neon',spawns,rows:arena((x,y)=>(x%4!==1||y%4!==3)&&dense(7,x,y))},
  {id:'neon-loop',name:'光轨回环',theme:'neon',spawns,rows:arena((x,y)=>!((x===5||x===13)&&(y>=3&&y<=11))&&!((y===3||y===11)&&(x>=5&&x<=13))&&dense(8,x,y))},
];

export const getMap = (id: string) => MAPS.find(map => map.id === id) ?? MAPS[0];
export const cellKey = (x: number, y: number) => `${x},${y}`;
export const isSolid = (map: ArenaMap, x: number, y: number, destroyed: string[]) => {
  const tile = map.rows[y]?.[x] ?? '#';
  return tile === '#' || (tile === '+' && !destroyed.includes(cellKey(x,y)));
};
