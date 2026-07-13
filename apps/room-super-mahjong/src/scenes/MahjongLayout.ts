export type Rect = { x:number; y:number; w:number; h:number };
export type Point = { x:number; y:number };

export type LobbyLayout = {
  portrait:boolean;
  columns:2|4;
  header:Rect;
  seatsArea:Rect;
  seatCards:Rect[];
  rulesArea:Rect;
  ruleCards:Rect[];
  actionBar:Rect;
};

export type TableLayout = {
  portrait:boolean;
  compact:boolean;
  activityLines:1|3;
  capsuleSafeArea:Rect;
  hud:Rect;
  table:Rect;
  center:Rect;
  seats:Rect[];
  rivers:Rect[];
  melds:Rect[];
  actions:Rect;
  hand:{ rect:Rect; tileWidth:number; tileHeight:number; gap:number; startX:number; totalWidth:number; y:number };
};

const pad = 12;

export function computeLobbyLayout(width:number,height:number):LobbyLayout {
  const portrait=height>width;
  const columns:2|4=portrait?2:4;
  const compact=height<560;
  const gap=compact?6:10;
  const headerH=compact?48:portrait?82:70;
  const actionH=compact?52:64;
  const actionBar={x:pad,y:height-actionH-pad,w:width-pad*2,h:actionH};
  const seatsY=pad+headerH;
  const seatRows=portrait?2:1;
  const seatH=compact?38:48;
  const seatsArea={x:pad,y:seatsY,w:width-pad*2,h:seatRows*seatH+(seatRows-1)*gap};
  const seatCards=grid(seatsArea,columns,seatRows,gap);
  const rulesY=seatsArea.y+seatsArea.h+gap+(compact?15:24);
  const rulesArea={x:pad,y:rulesY,w:width-pad*2,h:Math.max(84,actionBar.y-rulesY-gap)};
  const ruleRows=2;
  const ruleCards=grid(rulesArea,4,ruleRows,gap);
  return {portrait,columns,header:{x:pad,y:pad,w:width-pad*2,h:headerH-gap},seatsArea,seatCards,rulesArea,ruleCards,actionBar};
}

export function computeTableLayout(width:number,height:number,handCount:number):TableLayout {
  const portrait=height>width;
  const compact=height<560||width<560;
  const capsuleSafeArea={x:Math.max(0,width-96),y:0,w:96,h:58};
  const hudH=portrait?70:compact?62:82;
  const handH=portrait?104:compact?76:104;
  const actionH=compact?44:52;
  const actions={x:Math.max(pad,(width-Math.min(510,width-24))/2),y:height-handH-actionH-12,w:Math.min(510,width-24),h:actionH};
  const handRect={x:pad,y:height-handH,w:width-pad*2,h:handH-pad};
  const table={x:pad,y:hudH+4,w:width-pad*2,h:Math.max(120,actions.y-hudH-10)};
  const centerW=Math.min(portrait?170:230,table.w*.42);
  const centerH=Math.min(portrait?132:150,table.h*.46);
  const center={x:table.x+(table.w-centerW)/2,y:table.y+(table.h-centerH)/2,w:centerW,h:centerH};
  const badgeLong=portrait?112:Math.min(184,table.w*.22),badgeShort=portrait?42:compact?46:54;
  const seats:Rect[]=[
    {x:(width-badgeLong)/2,y:table.y+table.h-badgeShort,w:badgeLong,h:badgeShort},
    {x:table.x+table.w-badgeShort,y:center.y+(center.h-badgeLong)/2,w:badgeShort,h:badgeLong},
    {x:(width-badgeLong)/2,y:table.y,w:badgeLong,h:badgeShort},
    {x:table.x,y:center.y+(center.h-badgeLong)/2,w:badgeShort,h:badgeLong},
  ];
  const riverW=Math.max(76,Math.min(portrait?104:190,(table.w-center.w)/2-24));
  const riverH=Math.max(62,Math.min(portrait?100:116,(table.h-center.h)/2+26));
  const rivers:Rect[]=[
    {x:center.x+(center.w-riverW)/2,y:center.y+center.h+4,w:riverW,h:riverH},
    {x:center.x+center.w+4,y:center.y+(center.h-riverH)/2,w:riverW,h:riverH},
    {x:center.x+(center.w-riverW)/2,y:center.y-riverH-4,w:riverW,h:riverH},
    {x:center.x-riverW-4,y:center.y+(center.h-riverH)/2,w:riverW,h:riverH},
  ];
  const melds:Rect[]=seats.map((seat,index)=>index%2===0
    ?{x:Math.max(pad,seat.x-150),y:seat.y,w:140,h:seat.h}
    :{x:seat.x,y:index===1?Math.max(table.y,seat.y-82):seat.y+seat.h+6,w:seat.w,h:76});
  const count=Math.max(1,handCount);
  const available=handRect.w-16;
  const tileWidth=clamp(Math.min(portrait?38:58,available/(1+(count-1)*.7)),20,58);
  const tileHeight=tileWidth*1.34;
  const gapValue=count===1?tileWidth:Math.min(tileWidth*.72,(available-tileWidth)/(count-1));
  const totalWidth=tileWidth+gapValue*(count-1);
  return {portrait,compact,activityLines:portrait?1:3,capsuleSafeArea,hud:{x:0,y:0,w:width,h:hudH},table,center,seats,rivers,melds,actions,hand:{rect:handRect,tileWidth,tileHeight,gap:gapValue,startX:(width-totalWidth)/2,totalWidth,y:handRect.y+(handRect.h-tileHeight)/2}};
}

export function overlaps(a:Rect,b:Rect){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y}

function grid(area:Rect,columns:number,rows:number,gap:number){
  const cellW=(area.w-gap*(columns-1))/columns;
  const cellH=(area.h-gap*(rows-1))/rows;
  return Array.from({length:columns*rows},(_,index)=>({x:area.x+(index%columns)*(cellW+gap),y:area.y+Math.floor(index/columns)*(cellH+gap),w:cellW,h:cellH}));
}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value))}
