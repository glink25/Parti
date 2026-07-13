import type { TileKind } from '../worker/types';

type TileStyle = { selected?: boolean };
type Point = readonly [number, number];

const IVORY = '#fff9e8';
const RED = '#c81e3a';
const BLUE = '#075985';
const GREEN = '#087f5b';
const GOLD = '#ffc857';
const NUMERALS = ['一','二','三','四','五','六','七','八','九'] as const;

const DOT_PATTERNS: Record<number, Point[]> = {
  1:[[.5,.5]], 2:[[.5,.28],[.5,.72]], 3:[[.28,.25],[.5,.5],[.72,.75]],
  4:[[.3,.28],[.7,.28],[.3,.72],[.7,.72]], 5:[[.3,.25],[.7,.25],[.5,.5],[.3,.75],[.7,.75]],
  6:[[.3,.22],[.7,.22],[.3,.5],[.7,.5],[.3,.78],[.7,.78]],
  7:[[.28,.2],[.5,.32],[.72,.2],[.3,.55],[.7,.55],[.3,.8],[.7,.8]],
  8:[[.3,.16],[.7,.16],[.3,.39],[.7,.39],[.3,.62],[.7,.62],[.3,.85],[.7,.85]],
  9:[[.25,.2],[.5,.2],[.75,.2],[.25,.5],[.5,.5],[.75,.5],[.25,.8],[.5,.8],[.75,.8]],
};

const BAMBOO_PATTERNS: Record<number, Point[]> = {
  2:[[.35,.5],[.65,.5]], 3:[[.5,.2],[.32,.67],[.68,.67]],
  4:[[.35,.27],[.65,.27],[.35,.73],[.65,.73]], 5:[[.32,.24],[.68,.24],[.5,.5],[.32,.76],[.68,.76]],
  6:[[.3,.2],[.7,.2],[.3,.5],[.7,.5],[.3,.8],[.7,.8]],
  7:[[.3,.16],[.5,.3],[.7,.16],[.3,.57],[.7,.57],[.3,.84],[.7,.84]],
  8:[[.3,.14],[.7,.14],[.3,.38],[.7,.38],[.3,.62],[.7,.62],[.3,.86],[.7,.86]],
  9:[[.25,.18],[.5,.18],[.75,.18],[.25,.5],[.5,.5],[.75,.5],[.25,.82],[.5,.82],[.75,.82]],
};

export function drawMahjongTile(ctx: CanvasRenderingContext2D, kind: TileKind, x: number, y: number, width: number, height: number, style: TileStyle = {}) {
  const selected = Boolean(style.selected);
  ctx.save();
  ctx.shadowBlur = selected || kind === 'z' ? Math.max(5, width * .24) : Math.max(2, width * .07);
  ctx.shadowColor = kind === 'z' ? RED : selected ? GOLD : 'rgba(0,0,0,.5)';
  roundedRect(ctx, x, y, width, height, Math.max(3, width * .1));
  ctx.fillStyle = selected ? '#fff1ba' : IVORY; ctx.fill();
  ctx.strokeStyle = kind === 'z' ? RED : '#9bc8bd'; ctx.lineWidth = Math.max(1, width * .035); ctx.stroke();
  const inset = Math.max(2, width * .08);
  if (kind === 'z') drawRedCenter(ctx, x + inset, y + inset, width - inset * 2, height - inset * 2);
  else if (kind[0] === 'm') drawCharacter(ctx, Number(kind[1]), x + inset, y + inset, width - inset * 2, height - inset * 2);
  else if (kind[0] === 'p') drawCircles(ctx, Number(kind[1]), x + inset, y + inset, width - inset * 2, height - inset * 2);
  else drawBamboos(ctx, Number(kind[1]), x + inset, y + inset, width - inset * 2, height - inset * 2);
  ctx.restore();
}

function drawCharacter(ctx: CanvasRenderingContext2D, rank: number, x: number, y: number, width: number, height: number) {
  centeredText(ctx, NUMERALS[rank - 1]!, x + width / 2, y + height * .32, Math.max(9, width * .46), rank === 5 ? GREEN : BLUE, 800, 'serif');
  centeredText(ctx, '萬', x + width / 2, y + height * .71, Math.max(10, width * .48), RED, 900, 'serif');
}

function drawCircles(ctx: CanvasRenderingContext2D, rank: number, x: number, y: number, width: number, height: number) {
  const points = DOT_PATTERNS[rank]!;
  const radius = rank === 1 ? Math.min(width, height) * .26 : Math.min(width, height) * (rank >= 8 ? .095 : .115);
  points.forEach(([px, py], index) => drawCircle(ctx, x + width * px, y + height * py, radius, rank === 1 ? RED : [BLUE, GREEN, RED][index % 3]!));
}

function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.save(); ctx.lineWidth = Math.max(1, radius * .18); ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, radius * .55, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, Math.max(.8, radius * .15), 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawBamboos(ctx: CanvasRenderingContext2D, rank: number, x: number, y: number, width: number, height: number) {
  if (rank === 1) { drawBird(ctx, x, y, width, height); return; }
  const points = BAMBOO_PATTERNS[rank]!;
  const bambooWidth = Math.max(2.2, width * (rank >= 8 ? .105 : .13));
  const bambooHeight = Math.max(6, height * (rank >= 8 ? .19 : .22));
  points.forEach(([px, py], index) => drawBamboo(ctx, x + width * px, y + height * py, bambooWidth, bambooHeight, [GREEN, BLUE, RED][index % 3]!));
}

function drawBamboo(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-.08);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, width * .3); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -height * .42); ctx.lineTo(0, height * .42); ctx.stroke();
  ctx.lineWidth = Math.max(.8, width * .16);
  for (const offset of [-.18, .18]) { ctx.beginPath(); ctx.moveTo(-width * .45, height * offset); ctx.lineTo(width * .45, height * offset); ctx.stroke(); }
  ctx.restore();
}

function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const cx=x+width*.52, cy=y+height*.53, unit=Math.min(width,height);
  ctx.save();
  ctx.strokeStyle=GREEN; ctx.fillStyle=GREEN; ctx.lineWidth=Math.max(1,unit*.045); ctx.lineCap='round';
  ctx.beginPath(); ctx.ellipse(cx,cy,unit*.19,unit*.28,-.16,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=BLUE; ctx.beginPath(); ctx.ellipse(cx-unit*.02,cy+unit*.01,unit*.11,unit*.2,.42,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=GREEN; ctx.beginPath(); ctx.arc(cx+unit*.1,cy-unit*.25,unit*.11,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=RED; ctx.beginPath(); ctx.moveTo(cx+unit*.18,cy-unit*.25);ctx.lineTo(cx+unit*.34,cy-unit*.2);ctx.lineTo(cx+unit*.18,cy-unit*.16);ctx.closePath();ctx.fill();
  ctx.fillStyle=IVORY;ctx.beginPath();ctx.arc(cx+unit*.13,cy-unit*.28,unit*.025,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=RED;ctx.beginPath();ctx.moveTo(cx-unit*.12,cy+unit*.2);ctx.lineTo(cx-unit*.28,cy+unit*.38);ctx.moveTo(cx,cy+unit*.23);ctx.lineTo(cx+unit*.08,cy+unit*.42);ctx.stroke();
  ctx.strokeStyle=BLUE;ctx.beginPath();ctx.moveTo(cx-unit*.08,cy+unit*.3);ctx.lineTo(cx-unit*.18,cy+unit*.47);ctx.moveTo(cx+unit*.04,cy+unit*.3);ctx.lineTo(cx+unit*.14,cy+unit*.47);ctx.stroke();
  ctx.restore();
}

function drawRedCenter(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.strokeStyle=RED;ctx.lineWidth=Math.max(1,width*.05);ctx.strokeRect(x+width*.12,y+height*.08,width*.76,height*.84);
  centeredText(ctx,'中',x+width/2,y+height*.5,Math.max(12,width*.62),RED,900,'serif');
}

function centeredText(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,size:number,color:string,weight:number,family:string){ctx.font=`${weight} ${size}px ${family}`;ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y)}
function roundedRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
