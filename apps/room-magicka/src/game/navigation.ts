import type { MapManifest,Point } from './contracts';
import { PLAYER_RADIUS,isWalkable } from './map';

export type SteeringResult={position:Point;heading:number;moved:boolean;distanceGain:number;blocked:boolean};

export function steerToward(map:MapManifest,from:Point,target:Point,step:number,previousHeading:number|null,canOccupy:(p:Point)=>boolean=(p)=>isWalkable(map,p,PLAYER_RADIUS)):SteeringResult{
 const before=Math.hypot(target.x-from.x,target.y-from.y),desired=Math.atan2(target.y-from.y,target.x-from.x),travel=Math.min(step,before),offsets=[0,.22,-.22,.42,-.42,.68,-.68,.95,-.95,1.25,-1.25,1.5,-1.5],angles=[...(previousHeading==null?[]:[previousHeading]),...offsets.map(offset=>desired+offset)],unique=[...new Set(angles.map(angle=>Math.round(angle*1000)/1000))];let best:{p:Point;angle:number;score:number;gain:number}|null=null;
 for(const angle of unique){const p={x:from.x+Math.cos(angle)*travel,y:from.y+Math.sin(angle)*travel};if(!canOccupy(p))continue;const after=Math.hypot(target.x-p.x,target.y-p.y),gain=before-after,alignment=Math.cos(shortest(angle,desired)),continuity=previousHeading==null?0:Math.cos(shortest(angle,previousHeading)),probe={x:from.x+Math.cos(angle)*(travel+PLAYER_RADIUS+12),y:from.y+Math.sin(angle)*(travel+PLAYER_RADIUS+12)},clearance=canOccupy(probe)?1:0,score=gain*4+alignment*9+continuity*5+clearance*6;if(!best||score>best.score)best={p,angle,score,gain};}
 if(!best)return{position:{...from},heading:previousHeading??desired,moved:false,distanceGain:0,blocked:true};return{position:best.p,heading:best.angle,moved:true,distanceGain:best.gain,blocked:Math.abs(shortest(best.angle,desired))>.08};
}
export function steeringTimedOut(stuckSince:number,now:number,timeoutMs=1500){return stuckSince>0&&now-stuckSince>=timeoutMs;}

function shortest(from:number,to:number){return Math.atan2(Math.sin(from-to),Math.cos(from-to));}
