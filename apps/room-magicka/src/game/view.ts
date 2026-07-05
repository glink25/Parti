import type { Point } from './contracts';

export type ScreenRect={x:number;y:number;w:number;h:number};

export function targetCameraScale(width:number,height:number,inCombat:boolean){const base=Math.max(.62,Math.min(1.15,Math.min(width/1050,height/680))),worldZoom=inCombat?1.21:1.1;return base/worldZoom;}

export function offscreenIndicator(target:Point,center:Point,view:ScreenRect,padding:number):({x:number;y:number;angle:number}|null){
 const dx=target.x-center.x,dy=target.y-center.y,halfW=Math.max(1,view.w/2-padding),halfH=Math.max(1,view.h/2-padding);
 if(Math.abs(dx)<=halfW&&Math.abs(dy)<=halfH)return null;
 const factor=1/Math.max(Math.abs(dx)/halfW,Math.abs(dy)/halfH);
 return{x:view.x+view.w/2+dx*factor,y:view.y+view.h/2+dy*factor,angle:Math.atan2(dy,dx)};
}
