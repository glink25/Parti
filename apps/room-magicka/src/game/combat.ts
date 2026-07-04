import { WORLD_HEIGHT,WORLD_WIDTH,type AimState,type ControlEffect,type ControlState,type EnemyState,type PendingCast,type Point,type SpellPlan } from './contracts';

export const ZERO_CONTROL:ControlState={vx:0,vy:0,z:0,vz:0,slowedUntil:0,slowScale:1,stunnedUntil:0};
export function distance(a:Point,b:Point){return Math.hypot(a.x-b.x,a.y-b.y);}
export function normalize(from:Point,to:Point){const dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy)||1;return{x:dx/d,y:dy/d};}
export function angleTo(from:Point,to:Point){return Math.atan2(to.y-from.y,to.x-from.x);}
export function shortestAngle(from:number,to:number){return Math.atan2(Math.sin(to-from),Math.cos(to-from));}
export function turnToward(current:number,target:number,maxStep:number){const d=shortestAngle(current,target);return current+Math.sign(d)*Math.min(Math.abs(d),maxStep);}
export function rayToBoundary(origin:Point,angle:number){const dx=Math.cos(angle),dy=Math.sin(angle),times=[dx>0?(WORLD_WIDTH-origin.x)/dx:dx<0?-origin.x/dx:Infinity,dy>0?(WORLD_HEIGHT-origin.y)/dy:dy<0?-origin.y/dy:Infinity];const t=Math.min(...times.filter(v=>v>=0));return{x:origin.x+dx*t,y:origin.y+dy*t};}
export function projectionOnRay(origin:Point,angle:number,p:Point){const dx=Math.cos(angle),dy=Math.sin(angle),px=p.x-origin.x,py=p.y-origin.y;return{along:px*dx+py*dy,perp:Math.abs(px*dy-py*dx)};}
export function beamTargets(origin:Point,angle:number,width:number,enemies:readonly EnemyState[],pierce:number){return enemies.map(e=>({enemy:e,...projectionOnRay(origin,angle,e)})).filter(v=>v.along>=0&&v.perp<=width+v.enemy.radius).sort((a,b)=>a.along-b.along).slice(0,Math.max(1,pierce+1));}
export function coneContains(origin:Point,angle:number,range:number,halfAngle:number,p:Point,radius=0){const d=distance(origin,p);if(d>range+radius)return false;return Math.abs(shortestAngle(angle,angleTo(origin,p)))<=halfAngle+Math.asin(Math.min(1,radius/Math.max(d,1)));}
export function circleContains(center:Point,radius:number,p:Point,targetRadius=0){return distance(center,p)<=radius+targetRadius;}
export function createPending(id:string,aim:AimState,releasedAt:number):PendingCast{return{id,plan:aim.plan,origin:{x:0,y:0},target:{...aim.target},releasedAt,triggersAt:releasedAt+aim.plan.castMs};}
export function canAct(control:ControlState,now:number){return control.z<=0&&control.stunnedUntil<=now;}
export function applyControl(state:ControlState,effect:ControlEffect,direction:Point,now:number){const next={...state};if(effect.kind==='knockback'){next.vx+=direction.x*effect.strength;next.vy+=direction.y*effect.strength;}else if(effect.kind==='knockup'){next.vz=Math.max(next.vz,effect.strength);next.z=Math.max(1,next.z);}else if(effect.kind==='slow'){next.slowedUntil=Math.max(next.slowedUntil,now+effect.durationMs);next.slowScale=Math.min(next.slowScale,effect.strength);}else next.stunnedUntil=Math.max(next.stunnedUntil,now+effect.durationMs);return next;}
export function advanceControl(state:ControlState,dt:number,now:number){const next={...state};next.z=Math.max(0,next.z+next.vz*dt);next.vz-=900*dt;if(next.z<=0&&next.vz<0)next.vz=0;const drag=Math.pow(.08,dt);next.vx*=drag;next.vy*=drag;if(now>=next.slowedUntil)next.slowScale=1;return next;}
export function enemyCap(players:number){return[0,8,12,16,20][Math.max(0,Math.min(4,players))]??20;}
export function spellDirection(origin:Point,target:Point){return normalize(origin,target);}
export function spellDamage(plan:SpellPlan){return plan.effects.filter(e=>e.type==='damage').reduce((n,e)=>n+e.amount,0);}
