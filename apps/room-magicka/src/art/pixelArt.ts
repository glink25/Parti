import type {Element,EnemyKind,PlayerActivity,PlayerEquipment,StatusInstance} from '../game/contracts';

export const PIXEL_ART={playerFrame:64,normalEnemyFrame:64,eliteEnemyFrame:96,bossFrame:128,foot:{x:32,y:52},shadow:{w:32,h:12},fps:10} as const;
export type Facing='e'|'ne'|'n'|'nw'|'w'|'sw'|'s'|'se';
export type PlayerAnim='idle'|'move'|'cast-windup'|'channel'|'cast-release'|'recovery'|'hit'|'stunned'|'downed'|'revive';
export const PLAYER_ANIMATION_FRAMES:Record<PlayerAnim,number>={idle:4,move:6,'cast-windup':4,channel:4,'cast-release':3,recovery:3,hit:3,stunned:2,downed:4,revive:5};

const elementColors:Record<Element,string>={rock:'#c49a6c',fire:'#ff5b3a',ice:'#80efff',life:'#78ef83',lightning:'#d29aff',water:'#4ca8ff',shield:'#ffe36a'};
const robeColors:Record<string,[string,string]>= {
 'ward-robe':['#536b91','#91a8d0'],'path-robe':['#8a603e','#c99a62'],'bog-robe':['#385f4b','#6da67e'],
 'insulated-robe':['#584679','#967fbe'],'obsidian-robe':['#272333','#5e536f'],'ash-robe':['#704a43','#aa7568']
};

export function facingFromAngle(angle:number):Facing{return(['e','se','s','sw','w','nw','n','ne'] as Facing[])[Math.round(((angle%(Math.PI*2))+Math.PI*2)/(Math.PI/4))%8]!;}
export function animationFor(activity:PlayerActivity|undefined,downed:boolean,moving:boolean,statuses:readonly StatusInstance[]):PlayerAnim{
 if(downed||activity?.phase==='downed')return'downed';if(activity?.phase==='stunned'||statuses.some(s=>s.kind==='frozen'||s.kind==='shocked'))return'stunned';
 if(activity?.phase==='windup'||activity?.phase==='aiming')return'cast-windup';if(activity?.phase==='channeling')return'channel';if(activity?.phase==='recovery')return'recovery';return moving?'move':'idle';
}
export function animationFrame(anim:PlayerAnim,now:number,phaseStartedAt=0){const frames=PLAYER_ANIMATION_FRAMES[anim],loop=anim==='idle'||anim==='move'||anim==='channel'||anim==='stunned';const raw=Math.floor(Math.max(0,now-phaseStartedAt)/(1000/PIXEL_ART.fps));return loop?raw%frames:Math.min(frames-1,raw);}

type PlayerDraw={x:number;y:number;scale:number;facing:Facing;anim:PlayerAnim;frame:number;color:string;equipment?:PlayerEquipment;statuses?:readonly StatusInstance[];alpha?:number};
export function drawPixelPlayer(c:CanvasRenderingContext2D,o:PlayerDraw){
 const u=Math.max(1,Math.round(o.scale*2))/2,x=Math.round(o.x),y=Math.round(o.y),bob=o.anim==='move'?(o.frame%2?0:-2)*u:o.anim==='idle'&&o.frame===2?-u:0,down=o.anim==='downed',flip=o.facing.includes('w')?-1:1;
 const robe=robeColors[o.equipment?.robe?.prototypeId??'']??[o.color,lighten(o.color)],back=o.facing==='n'||o.facing==='ne'||o.facing==='nw';
 c.save();c.globalAlpha=o.alpha??1;c.imageSmoothingEnabled=false;
 pxEllipse(c,x,y+2*u,16*u,5*u,'rgba(0,0,0,.42)');
 if(o.equipment?.ring)drawRing(c,x,y,u,o.equipment.ring.mechanicId,o.frame);
 if(down){px(c,x-20*u,y-7*u,40*u,10*u,robe[0]);px(c,x+flip*13*u,y-13*u,10*u,10*u,'#d8b091');c.restore();return;}
 const cy=y-24*u+bob,cast=o.anim==='cast-windup'||o.anim==='channel'||o.anim==='cast-release',armLift=cast?8*u:0;
 if(o.equipment?.staff&&back)drawStaff(c,x+flip*17*u,cy+4*u,u,o.equipment,cast,o.frame);
 px(c,x-7*u,cy-5*u,5*u,14*u,'#b7876c');px(c,x+2*u,cy-5*u-armLift,5*u,14*u,'#d4a88a');
 px(c,x-9*u,cy-4*u,18*u,15*u,'#2a2232');
 const sway=o.anim==='move'?(o.frame%3-1)*u:0;poly(c,[[x-8*u,cy+4*u],[x+8*u,cy+4*u],[x+12*u+sway,cy+25*u],[x-12*u+sway,cy+25*u]],robe[0]);
 px(c,x-7*u,cy+7*u,14*u,3*u,robe[1]);px(c,x-4*u,cy+12*u,3*u,9*u,robe[1]);
 px(c,x-7*u,cy-15*u,14*u,12*u,'#d7aa8c');px(c,x-9*u,cy-17*u,18*u,6*u,'#211b29');
 if(o.equipment?.staff&&!back)drawStaff(c,x+flip*17*u,cy+4*u,u,o.equipment,cast,o.frame);
 drawStatuses(c,x,cy,u,o.statuses??[],o.frame);
 c.restore();
}

function drawStaff(c:CanvasRenderingContext2D,x:number,y:number,u:number,equipment:PlayerEquipment,cast:boolean,frame:number){const affinity=Object.keys(equipment.staff?.stats.elementPower??{})[0] as Element|undefined,glow=elementColors[affinity??'shield'];px(c,x-2*u,y-(cast?22:13)*u,3*u,30*u,'#765238');px(c,x-5*u,y-(cast?27:18)*u,9*u,7*u,glow);if(frame%2===0)px(c,x-2*u,y-(cast?30:21)*u,3*u,3*u,'#fff1c9');}
function drawRing(c:CanvasRenderingContext2D,x:number,y:number,u:number,mechanic:string,frame:number){const col=mechanic==='quick-cast'?'#d29aff':'#ffd66d';c.strokeStyle=col;c.lineWidth=Math.max(1,u);c.setLineDash([3*u,3*u]);c.lineDashOffset=-frame*u;c.beginPath();c.ellipse(x,y,19*u,7*u,0,0,Math.PI*2);c.stroke();c.setLineDash([]);}
function drawStatuses(c:CanvasRenderingContext2D,x:number,y:number,u:number,statuses:readonly StatusInstance[],frame:number){for(const [i,s] of statuses.slice(0,3).entries()){const col=s.kind==='burning'?'#ff633f':s.kind==='wet'?'#55bfff':s.kind==='frozen'||s.kind==='chilled'?'#9af3ff':s.kind==='shielded'?'#ffe36a':s.kind==='shocked'?'#d49aff':'#75ef8a',a=(i*2+frame)*2.1;px(c,x+Math.round(Math.cos(a)*14)*u,y-18*u+Math.round(Math.sin(a)*5)*u,3*u,3*u,col);}}

type EnemyDraw={x:number;y:number;scale:number;kind:EnemyKind;radius:number;elite?:boolean;attacking?:boolean;flash?:boolean;frame:number};
const enemyPalette:Partial<Record<EnemyKind,[string,string,string]>>={
 chaser:['#8e3842','#d85b50','#f0b36e'],shooter:['#55386f','#a76bd0','#e4a6ff'],'water-fiend':['#174b68','#2c91b5','#82e5ff'],'shield-guard':['#494653','#8d8a91','#e0b755'],
 'reflect-warden':['#3d355d','#8a73c6','#f2d7ff'],'resonance-priest':['#52334f','#c05d96','#ffb8e5'],'ruin-guardian':['#3d3a42','#887c6b','#f2b84b']
};
export function drawPixelEnemy(c:CanvasRenderingContext2D,o:EnemyDraw){const p=enemyPalette[o.kind]??['#492c3b','#a55264','#f0a06f'],u=Math.max(1,Math.round(o.scale*2))/2,x=Math.round(o.x),y=Math.round(o.y),bob=o.frame%2?0:-u,boss=o.kind==='ruin-guardian',w=(boss?35:o.elite?25:20)*u,h=(boss?44:o.elite?31:25)*u;c.save();c.imageSmoothingEnabled=false;pxEllipse(c,x,y+3*u,w*.75,5*u,'rgba(0,0,0,.45)');if(o.flash)c.globalCompositeOperation='lighter';
 if(o.kind==='shooter'||o.kind==='resonance-priest'){poly(c,[[x-w/2,y],[x,y-h+bob],[x+w/2,y]],p[0]);px(c,x-4*u,y-h+8*u+bob,8*u,8*u,p[2]);px(c,x+9*u,y-h/2+bob,3*u,18*u,p[1]);}
 else if(o.kind==='water-fiend'){pxEllipse(c,x,y-h/2+bob,w/2,h/2,p[0]);for(let i=-2;i<=2;i++)px(c,x+i*4*u,y-4*u,3*u,8*u,p[1]);px(c,x-6*u,y-h/2+bob,4*u,3*u,p[2]);px(c,x+2*u,y-h/2+bob,4*u,3*u,p[2]);}
 else{px(c,x-w/2,y-h+bob,w,h,p[0]);px(c,x-w*.38,y-h*.72+bob,w*.76,h*.35,p[1]);px(c,x-w*.24,y-h*.62+bob,4*u,3*u,p[2]);px(c,x+w*.12,y-h*.62+bob,4*u,3*u,p[2]);if(o.kind==='shield-guard'||o.kind==='reflect-warden')px(c,x-w*.72,y-h*.72+bob,8*u,h*.65,p[2]);if(boss){px(c,x-w*.65,y-h-7*u+bob,w*1.3,8*u,p[2]);px(c,x-4*u,y-h-13*u+bob,8*u,8*u,'#fff0a0');}}
 if(o.attacking){c.strokeStyle='#ffdf65';c.lineWidth=2*u;c.strokeRect(x-w*.65,y-h-5*u+bob,w*1.3,h+8*u);}c.restore();}

export function drawElementProjectile(c:CanvasRenderingContext2D,x:number,y:number,r:number,element:Element,now:number){const col=elementColors[element],a=now/90;c.save();c.imageSmoothingEnabled=false;for(let i=0;i<3;i++){const q=a+i*2.1;px(c,Math.round(x-Math.cos(q)*(r+i*3)),Math.round(y-Math.sin(q)*(r+i*3)),Math.max(2,r*.25),Math.max(2,r*.25),col);}px(c,Math.round(x-r*.55),Math.round(y-r*.55),Math.max(3,r*1.1),Math.max(3,r*1.1),col);px(c,Math.round(x-r*.18),Math.round(y-r*.18),Math.max(2,r*.36),Math.max(2,r*.36),'#fff5d5');c.restore();}

function px(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,color:string){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function pxEllipse(c:CanvasRenderingContext2D,x:number,y:number,rx:number,ry:number,color:string){c.fillStyle=color;c.beginPath();c.ellipse(Math.round(x),Math.round(y),Math.round(rx),Math.round(ry),0,0,Math.PI*2);c.fill();}
function poly(c:CanvasRenderingContext2D,points:number[][],color:string){c.fillStyle=color;c.beginPath();c.moveTo(Math.round(points[0]![0]!),Math.round(points[0]![1]!));for(const p of points.slice(1))c.lineTo(Math.round(p[0]!),Math.round(p[1]!));c.closePath();c.fill();}
function lighten(hex:string){const n=parseInt(hex.slice(1),16),r=Math.min(255,(n>>16)+42),g=Math.min(255,((n>>8)&255)+42),b=Math.min(255,(n&255)+42);return`#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;}
