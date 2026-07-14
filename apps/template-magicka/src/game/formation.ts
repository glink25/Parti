import type { Point } from './contracts';

export const FORMATION_DIRECTIONS:readonly Point[]=[
 {x:0,y:-1},
 {x:1,y:0},
 {x:0,y:1},
 {x:-1,y:0},
];

export function formationPosition(center:Point,index:number,radius:number):Point{
 const direction=FORMATION_DIRECTIONS[index];
 if(!direction)throw new RangeError(`Unsupported formation slot ${index}`);
 return{x:center.x+direction.x*radius,y:center.y+direction.y*radius};
}

export function orderedPlayerIds(order:readonly string[],players:Record<string,unknown>){
 return order.filter(id=>id in players).slice(0,FORMATION_DIRECTIONS.length);
}
