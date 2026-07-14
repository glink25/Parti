import type { AttackDefinition, EnemyKind, PickupKind, PlatformKind } from '../game/contracts';

export type ScreenPoint = { x: number; y: number };
export type PlatformArt = { kind: PlatformKind; color: string; warning: boolean; spikeRange?: [number, number] };

const backgrounds = Object.fromEntries(['aurora', 'garden', 'storm'].map((id) => {
  const image = new Image(); image.src = `/assets/skyward-2/backgrounds/${id}.jpg`; return [id, image];
})) as Record<string, HTMLImageElement>;
const characterAtlas = new Image(); characterAtlas.src = '/assets/skyward-2/sprites/characters.webp';
const pickupAtlas = new Image(); pickupAtlas.src = '/assets/skyward-2/sprites/pickups.webp';

const ink = '#14233b';
function path(c: CanvasRenderingContext2D, points: readonly [number, number][], close = true) { c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); if (close) c.closePath(); }
function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
function glow(c: CanvasRenderingContext2D, color: string, blur: number) { c.shadowColor = color; c.shadowBlur = blur; }

function drawCover(c:CanvasRenderingContext2D,image:HTMLImageElement,x:number,y:number,w:number,h:number,alpha:number){if(!image.complete||!image.naturalWidth||alpha<=0)return;const ratio=Math.max(w/image.naturalWidth,h/image.naturalHeight),sw=image.naturalWidth*ratio,sh=image.naturalHeight*ratio;c.save();c.globalAlpha=alpha;c.drawImage(image,x+(w-sw)/2,y+(h-sh)/2,sw,sh);c.restore();}
export function drawBackground(c: CanvasRenderingContext2D, biome: string, nextBiome: string, mix: number, x: number, y: number, w: number, h: number, fallback: string) {
  c.fillStyle = fallback; c.fillRect(x, y, w, h); drawCover(c,backgrounds[biome]!,x,y,w,h,.76*(1-mix)); drawCover(c,backgrounds[nextBiome]!,x,y,w,h,.76*mix); c.fillStyle='rgba(3,8,20,.2)';c.fillRect(x,y,w,h);
}

function drawAtlasCell(c:CanvasRenderingContext2D,image:HTMLImageElement,index:number,s:ScreenPoint,size:number,flip=false){if(!image.complete||!image.naturalWidth)return false;const cell=image.naturalWidth/3,row=Math.floor(index/3),col=index%3;c.save();c.translate(s.x,s.y);if(flip)c.scale(-1,1);c.drawImage(image,col*cell,row*cell,cell,cell,-size/2,-size/2,size,size);c.restore();return true;}

export function drawPlatformArt(c: CanvasRenderingContext2D, s: ScreenPoint, w: number, h: number, art: PlatformArt, scale: number) {
  c.save(); const y = s.y - h / 2, warn = art.warning ? '#ffe784' : art.color; c.lineJoin = 'round'; c.lineWidth = Math.max(2, 3 * scale); c.strokeStyle = ink;
  c.fillStyle = warn; path(c, [[s.x-w/2,y],[s.x+w/2,y],[s.x+w/2-8*scale,y+h],[s.x-w/2+8*scale,y+h]]); c.fill(); c.stroke();
  c.globalAlpha = .38; c.fillStyle = '#fff'; c.fillRect(s.x-w/2+7*scale,y+3*scale,Math.max(0,w-14*scale),3*scale); c.globalAlpha = 1;
  if (art.kind === 'moving') { c.strokeStyle='#d9fbff'; c.beginPath(); c.moveTo(s.x-15*scale,s.y); c.lineTo(s.x+15*scale,s.y); c.stroke(); path(c,[[s.x-18*scale,s.y],[s.x-10*scale,s.y-6*scale],[s.x-10*scale,s.y+6*scale]]); c.fillStyle='#d9fbff'; c.fill(); path(c,[[s.x+18*scale,s.y],[s.x+10*scale,s.y-6*scale],[s.x+10*scale,s.y+6*scale]]); c.fill(); }
  if (art.kind === 'fragile' || art.kind === 'recovering') { c.strokeStyle='#553c55'; c.beginPath(); c.moveTo(s.x-8*scale,y); c.lineTo(s.x+2*scale,y+8*scale); c.lineTo(s.x+14*scale,y+2*scale); c.stroke(); }
  if (art.kind === 'trigger') { circle(c,s.x,s.y,7*scale); c.fillStyle='#eafff7'; c.fill(); c.stroke(); }
  if (art.kind === 'spring') { c.strokeStyle='#fff4a8'; c.beginPath(); for(let i=-2;i<=2;i++) c.lineTo(s.x+i*8*scale,s.y+(i%2?6:-6)*scale); c.stroke(); }
  if (art.kind === 'boss-exit') { glow(c,'#ffd35a',12*scale); c.strokeStyle='#fff2a8'; c.strokeRect(s.x-w*.25,y-7*scale,w*.5,5*scale); }
  if (art.spikeRange) { const left=s.x-w/2+w*art.spikeRange[0], right=s.x-w/2+w*art.spikeRange[1]; c.fillStyle='#f4f7ff'; for(let x=left;x<right;x+=18*scale){ path(c,[[x,y],[x+9*scale,y-20*scale],[x+18*scale,y]]); c.fill(); c.stroke(); } }
  c.restore();
}

export function drawPlayerArt(c: CanvasRenderingContext2D, s: ScreenPoint, r: number, color: string, direction: number, local: boolean) {
  c.save();glow(c,color,r*.7);circle(c,s.x,s.y,r*.74);c.fillStyle='rgba(255,255,255,.18)';c.fill();c.restore();if(drawAtlasCell(c,characterAtlas,0,s,r*2.65,direction<0))return;
  c.save(); c.translate(s.x,s.y); if(direction<0)c.scale(-1,1); c.lineWidth=Math.max(2,r*.09); c.strokeStyle=ink; glow(c,color,r*.45);
  c.fillStyle=color; circle(c,0,0,r*.72); c.fill(); c.stroke(); c.shadowBlur=0;
  c.fillStyle='#f7fbff'; circle(c,r*.25,-r*.12,r*.22); c.fill(); c.stroke(); c.fillStyle=local?'#493f00':'#17325a'; circle(c,r*.3,-r*.1,r*.08); c.fill();
  c.fillStyle='#fff'; path(c,[[-r*.55,r*.18],[-r*.95,r*.42],[-r*.55,r*.52]]); c.fill(); c.stroke();
  c.fillStyle='#ffbd72'; path(c,[[r*.55,r*.12],[r*.95,r*.25],[r*.56,r*.38]]); c.fill(); c.stroke(); c.restore();
}

export function drawEnemyArt(c: CanvasRenderingContext2D, kind: EnemyKind, s: ScreenPoint, r: number, hp: number) {
  const spriteIndex:Record<EnemyKind,number>={sentry:1,floater:2,patroller:3,charger:4,occupier:5,'storm-warden':6,'sky-behemoth':7,'mechanical-core':8};const bossSprite=spriteIndex[kind]>=6;if(drawAtlasCell(c,characterAtlas,spriteIndex[kind],s,r*(bossSprite?2.9:2.65))){if(bossSprite){c.fillStyle='#16223b';c.fillRect(s.x-r*.65,s.y+r*1.22,r*1.3,8);c.fillStyle='#ff6e87';c.fillRect(s.x-r*.65,s.y+r*1.22,r*1.3*Math.max(0,Math.min(1,hp/32)),8);}return;}
  c.save(); c.translate(s.x,s.y); c.lineWidth=Math.max(2,r*.08); c.strokeStyle=ink; const boss=kind==='storm-warden'||kind==='sky-behemoth'||kind==='mechanical-core';
  const colors: Record<EnemyKind,string>={sentry:'#ff9b68',floater:'#69e6ff',patroller:'#ffca66',charger:'#ff6f79',occupier:'#9fe07b','storm-warden':'#caa5ff','sky-behemoth':'#96e095','mechanical-core':'#ff8e75'}; c.fillStyle=colors[kind]; glow(c,colors[kind],boss?r*.45:r*.2);
  if(kind==='floater'||kind==='storm-warden'){ circle(c,0,0,r*.72); c.fill(); c.stroke(); for(let i=-1;i<=1;i++){c.beginPath();c.moveTo(i*r*.35,r*.55);c.quadraticCurveTo(i*r*.55,r*1.05,i*r*.22,r*1.2);c.stroke();} }
  else if(kind==='sky-behemoth'){ path(c,[[-r,-r*.15],[-r*.35,-r*.78],[r*.5,-r*.65],[r,-r*.05],[r*.45,r*.72],[-r*.5,r*.65]]);c.fill();c.stroke(); path(c,[[-r*.65,-r*.25],[-r*1.2,-r*.65],[-r*.95,r*.05]]);c.fill();c.stroke(); }
  else { path(c,[[-r*.72,-r*.62],[r*.72,-r*.62],[r*.82,r*.45],[0,r*.78],[-r*.82,r*.45]]); c.fill();c.stroke(); if(kind==='charger'){path(c,[[-r*.6,-r*.5],[-r*.95,-r*1.05],[-r*.2,-r*.62]]);c.fill();c.stroke();path(c,[[r*.6,-r*.5],[r*.95,-r*1.05],[r*.2,-r*.62]]);c.fill();c.stroke();} }
  c.shadowBlur=0; c.fillStyle='#fff'; circle(c,-r*.25,-r*.08,r*.18);c.fill();c.stroke();circle(c,r*.25,-r*.08,r*.18);c.fill();c.stroke(); c.fillStyle='#17233d';circle(c,-r*.22,-r*.05,r*.07);c.fill();circle(c,r*.22,-r*.05,r*.07);c.fill();
  if(boss){ c.fillStyle='#16223b'; c.fillRect(-r*.55,r*.9,r*1.1,8); c.fillStyle='#ff6e87'; c.fillRect(-r*.55,r*.9,r*1.1*Math.max(0,Math.min(1,hp/32)),8); } c.restore();
}

const pickupGlyph: Record<PickupKind,string>={shield:'◇',rapid:'»',power:'✦',spread:'⋔',pierce:'↑',rocket:'▲',propeller:'✣','super-jump':'⇧','slow-fall':'⌁'};
const pickupColor: Record<PickupKind,string>={shield:'#7eeeff',rapid:'#ffd463',power:'#ff7f79',spread:'#cda0ff',pierce:'#a7f5b3',rocket:'#ff9b62',propeller:'#75d8ff','super-jump':'#f6ef76','slow-fall':'#b6d4ff'};
export function drawPickupArt(c:CanvasRenderingContext2D,kind:PickupKind,s:ScreenPoint,r:number){const index:Record<PickupKind,number>={shield:0,rapid:1,power:2,spread:3,pierce:4,rocket:5,propeller:6,'super-jump':7,'slow-fall':8};c.save();glow(c,pickupColor[kind],r);circle(c,s.x,s.y,r*.82);c.fillStyle='rgba(255,255,255,.13)';c.fill();c.restore();if(drawAtlasCell(c,pickupAtlas,index[kind],s,r*2.75))return;c.save();glow(c,pickupColor[kind],r);c.fillStyle=pickupColor[kind];c.strokeStyle=ink;c.lineWidth=3;circle(c,s.x,s.y,r);c.fill();c.stroke();c.shadowBlur=0;c.fillStyle='#13213a';c.font=`bold ${r*1.15}px system-ui`;c.textAlign='center';c.textBaseline='middle';c.fillText(pickupGlyph[kind],s.x,s.y+1);c.restore();}

export function drawBulletArt(c:CanvasRenderingContext2D,s:ScreenPoint,remote:boolean){c.save();const color=remote?'#76b7ff':'#fff2a8';glow(c,color,14);c.fillStyle=color;circle(c,s.x,s.y,5);c.fill();c.fillRect(s.x-2,s.y,4,16);c.restore();}

export function drawAttackArt(c:CanvasRenderingContext2D,a:{kind:AttackDefinition['kind'];direction?:AttackDefinition['direction']},s:ScreenPoint,r:number,warning:boolean,viewport:{x:number;y:number;w:number;h:number}){c.save();const color=warning?'#ffe56c':'#ff5074';c.strokeStyle=color;c.fillStyle=color;c.lineWidth=warning?3:8;glow(c,color,18);c.setLineDash(warning?[10,8]:[]);
  if(a.kind==='laser'){c.beginPath();if(a.direction==='left'||a.direction==='right'){c.moveTo(viewport.x,s.y);c.lineTo(viewport.x+viewport.w,s.y)}else{c.moveTo(s.x,viewport.y);c.lineTo(s.x,viewport.y+viewport.h)}c.stroke();}
  else if(a.kind==='lightning'){c.beginPath();c.moveTo(s.x,s.y-r);for(let i=1;i<=7;i++)c.lineTo(s.x+(i%2?14:-10),s.y-r+i*r*.28);c.stroke();}
  else if(a.kind==='slam'){path(c,[[s.x-r,s.y+r*.6],[s.x,s.y-r],[s.x+r,s.y+r*.6]],false);c.stroke();}
  else {circle(c,s.x,s.y,r);warning?c.stroke():(c.globalAlpha=.18,c.fill(),c.globalAlpha=1,c.stroke()); if(a.kind==='tilt-zone'){c.beginPath();c.moveTo(s.x-r*.5,s.y);c.lineTo(s.x+r*.5,s.y);c.stroke();}}
  c.restore();}

export function drawVoidArt(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number){const g=c.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'rgba(255,70,112,.05)');g.addColorStop(.25,'rgba(210,32,80,.34)');g.addColorStop(1,'rgba(45,3,34,.9)');c.fillStyle=g;c.fillRect(x,y,w,h);c.strokeStyle='rgba(255,126,158,.65)';c.lineWidth=2;c.beginPath();for(let px=x;px<=x+w;px+=18)c.lineTo(px,y+Math.sin(px*.06+performance.now()*.003)*5);c.stroke();}
