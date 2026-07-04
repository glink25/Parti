export type Rect={x:number;y:number;w:number;h:number};
export type HudLayout={compact:boolean;status:Rect;message:Rect;minimap:Rect;inventoryButton:Rect;spellbookButton:Rect;elementPanel:Rect;elementCenters:Array<{x:number;y:number;r:number}>};
export type UiMessageCategory='tip'|'combat'|'objective'|'warning'|'system';
export type UiMessage={id:number;text:string;category:UiMessageCategory;priority:number;createdAt:number;expiresAt:number;dedupeKey?:string;count:number};
export type UiMessageInput={text:string;category?:UiMessageCategory;priority?:number;durationMs?:number;dedupeKey?:string};

const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export const contains=(rect:Rect,p:{x:number;y:number})=>p.x>=rect.x&&p.x<=rect.x+rect.w&&p.y>=rect.y&&p.y<=rect.y+rect.h;

export function computeHudLayout(width:number,height:number):HudLayout{
 const compact=width<900||height<560,pad=compact?8:12,mapW=clamp(width*.15,116,150),mapH=clamp(mapW*.68,82,100),buttonGap=6,buttonW=(mapW-buttonGap)/2,buttonH=compact?36:40;
 const minimap={x:width-pad-mapW,y:pad,w:mapW,h:mapH},inventoryButton={x:minimap.x,y:minimap.y+mapH+buttonGap,w:buttonW,h:buttonH},spellbookButton={x:minimap.x+buttonW+buttonGap,y:minimap.y+mapH+buttonGap,w:buttonW,h:buttonH};
 const diameter=clamp((width-32)/7-(compact?3:7),48,66),gap=clamp((width-diameter*7-24)/6,3,14),panelW=diameter*7+gap*6+20,panelH=compact?86:100,panelX=(width-panelW)/2,panelY=height-panelH-(compact?6:10),centerY=panelY+panelH-(diameter/2+7);
 return{compact,status:{x:pad,y:pad,w:compact?164:190,h:compact?68:76},message:{x:Math.max(pad,(width-Math.min(460,width*.48))/2),y:pad,w:Math.min(460,width*.48),h:compact?34:40},minimap,inventoryButton,spellbookButton,elementPanel:{x:panelX,y:panelY,w:panelW,h:panelH},elementCenters:Array.from({length:7},(_,i)=>({x:panelX+10+diameter/2+i*(diameter+gap),y:centerY,r:diameter/2}))};
}

export function hudBlocksWorld(layout:HudLayout,p:{x:number;y:number},modalOpen=false){return modalOpen||contains(layout.status,p)||contains(layout.message,p)||contains(layout.minimap,p)||contains(layout.inventoryButton,p)||contains(layout.spellbookButton,p)||contains(layout.elementPanel,p);}

export class UiMessageQueue{
 private messages:UiMessage[]=[];private sequence=0;
 push(input:UiMessageInput,now=performance.now()){
  this.prune(now);const duration=input.durationMs??1800,key=input.dedupeKey,existing=key?this.messages.find(message=>message.dedupeKey===key&&now-message.createdAt<=900):undefined;
  if(existing){existing.count+=1;existing.text=input.text;existing.createdAt=now;existing.expiresAt=now+duration;existing.priority=Math.max(existing.priority,input.priority??1);return existing;}
  const message:UiMessage={id:++this.sequence,text:input.text,category:input.category??'system',priority:input.priority??1,createdAt:now,expiresAt:now+duration,dedupeKey:key,count:1};this.messages.push(message);return message;
 }
 current(now=performance.now()){this.prune(now);return this.messages.slice().sort((a,b)=>b.priority-a.priority||a.createdAt-b.createdAt)[0]??null;}
 prune(now=performance.now()){this.messages=this.messages.filter(message=>message.expiresAt>now);}
 clear(){this.messages=[];}
}
