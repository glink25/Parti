import { mainCanvas, mainContext, mouseIsDown, mousePosScreen, mouseWasPressed, mouseWasReleased } from 'littlejsengine';
import type { Card, GameState, PlayAnalysis, PrivateState, SeatState, Suit } from '../game/types';
import { enumerateDoudizhu } from '../worker/variants/doudizhu';
import { enumerateGandengyan } from '../worker/variants/gandengyan';
import { isChameleonLegal } from '../worker/variants/chameleon';

type Rect={x:number;y:number;w:number;h:number};
type Hit=Rect&{onClick:()=>void};
type HandHit=Rect&{cardId:string;index:number};
type Gesture={select:boolean;start:number;last:number;initial:Set<string>};
const C={table:'#0f6b4f',dark:'#082f28',panel:'#0b2f28',gold:'#f8c75c',white:'#f8fafc',muted:'#a7c7bd',red:'#c0263f',cyan:'#5eead4'};
const SUITS:Exclude<Suit,'joker'>[]=['spades','hearts','clubs','diamonds'];

export class SuperPokerScene{
  private state:GameState|null=null;private privateState:PrivateState={hand:[],canPass:false,canDraw:false,needsChoice:false};private selected=new Set<string>();private hits:Hit[]=[];private handHits:HandHit[]=[];private gesture:Gesture|null=null;private ratio=1;private disposers:Array<()=>void>=[];private flash='';private flashUntil=0;private choiceSuit:Exclude<Suit,'joker'>='spades';private choiceRank=1;
  init(){this.disposers.push(parti.onState(value=>{this.state=value as GameState}),parti.onEvent('poker:private-state',value=>{this.privateState=value as PrivateState;for(const id of [...this.selected])if(!this.privateState.hand.some(c=>c.id===id))this.selected.delete(id);this.gesture=null}),parti.onEvent('poker:notice',value=>this.notice((value as {message:string}).message)),parti.onEvent('poker:action-fx',value=>{const event=value as {label?:string};if(event.label)this.notice(event.label)}),parti.onEvent('poker:settlement',value=>this.notice((value as {title:string}).title)));window.addEventListener('pagehide',this.destroy,{once:true});document.addEventListener('visibilitychange',this.visibility);parti.exposeToAgent?.(()=>buildPokerGuide(this.state,this.privateState,parti.playerId));parti.ready();void parti.action('syncPrivate')}
  update(){this.ratio=mainCanvas.width/Math.max(1,mainCanvas.clientWidth);const x=mousePosScreen.x/this.ratio,y=mousePosScreen.y/this.ratio;const card=[...this.handHits].reverse().find(h=>inside(h,x,y)),hit=[...this.hits].reverse().find(h=>inside(h,x,y));mainCanvas.style.cursor=card||hit?'pointer':'';if(this.gesture){if(mouseWasReleased(0)||!mouseIsDown(0))this.gesture=null;else if(card)this.extend(card.index);return}if(!mouseWasPressed(0))return;if(card)this.begin(card);else hit?.onClick()}
  render(){const w=mainCanvas.width/this.ratio,h=mainCanvas.height/this.ratio,c=mainContext;c.save();c.setTransform(this.ratio,0,0,this.ratio,0,0);c.clearRect(0,0,w,h);this.hits=[];this.handHits=[];c.fillStyle=C.table;c.fillRect(0,0,w,h);this.vignette(w,h);if(!this.state){this.center('正在连接房间…',w,h/2,22,C.white);c.restore();return}if(this.state.phase==='lobby')this.lobby(w,h);else this.table(w,h);if(this.flash&&performance.now()<this.flashUntil){this.panel(w/2-180,Math.min(110,h*.17),360,46,'#111827',C.gold,.94);this.center(this.flash,w,Math.min(126,h*.17+16),16,C.white,700)}c.restore()}
  private lobby(w:number,h:number){const state=this.state!,portrait=h>w,compact=h<620;this.text(18,18,'超级扑克',Math.min(30,w/14),C.white,800);this.text(18,55,state.message,13,C.muted);const variants=state.variants,gap=8,cardY=compact?82:94,cardH=compact?82:104,cardW=(w-36-gap*2)/3;variants.forEach((v,i)=>{const x=18+i*(cardW+gap),active=v.id===state.variantId;this.panel(x,cardY,cardW,cardH,active?'#176b54':C.panel,active?C.gold:'#278262');this.centerAt(x+cardW/2,cardY+18,v.name,17,active?C.gold:C.white,800);this.centerAt(x+cardW/2,cardY+42,`${v.minPlayers}${v.minPlayers===v.maxPlayers?'':`–${v.maxPlayers}`} 人`,12,C.muted);if(!portrait&&!compact)this.centerAt(x+cardW/2,cardY+68,v.rules[0]!,10,C.muted);if(state.hostId===parti.playerId)this.hits.push({x,y:cardY,w:cardW,h:cardH,onClick:()=>void parti.action('selectVariant',{variantId:v.id})})});
    const meta=variants.find(v=>v.id===state.variantId)!,seatTop=cardY+cardH+12,columns=portrait?2:4,seatGap=7,seatH=compact?42:52,seatW=(w-36-seatGap*(columns-1))/columns;for(let i=0;i<meta.maxPlayers;i+=1){const x=18+(i%columns)*(seatW+seatGap),y=seatTop+Math.floor(i/columns)*(seatH+seatGap),seat=state.seats[i];this.panel(x,y,seatW,seatH,seat?.bot?'#4b3520':seat?'#123f35':'#0a352d',seat?.ready?C.gold:'#2d7863');this.text(x+10,y+7,seat?seat.name:`席位 ${i+1}`,13,C.white,700);this.text(x+10,y+27,seat?seat.bot?'AI · 已准备':seat.ready?'真人 · 已准备':'真人 · 未准备':'空位',10,C.muted);if(state.hostId===parti.playerId&&(!seat||seat.bot))this.button(x+seatW-42,y+8,32,seatH-16,seat?'−':'+',()=>void parti.action(seat?'removeBot':'addBot',{seat:i}),false,12)}
    const rows=Math.ceil(meta.maxPlayers/columns),rulesY=seatTop+rows*(seatH+seatGap)+5,actionY=h-66;this.panel(18,rulesY,w-36,Math.max(70,actionY-rulesY-10),'rgba(5,31,25,.7)','#278262');this.text(30,rulesY+10,`${meta.name}规则`,13,C.gold,800);meta.rules.forEach((line,i)=>this.text(30,rulesY+34+i*20,`• ${line}`,Math.max(10,Math.min(13,w/38)),C.white));const me=this.me();if(me)this.button(w/2-(state.hostId===parti.playerId?146:70),actionY,state.hostId===parti.playerId?132:140,46,me.ready?'取消准备':'准备',()=>void parti.action('setReady',{ready:!me.ready}));if(state.hostId===parti.playerId)this.button(w/2+14,actionY,132,46,'开始游戏',()=>void parti.action('startGame'))}
  private table(w:number,h:number){const state=this.state!;this.text(18,14,state.variants.find(v=>v.id===state.variantId)?.name??'超级扑克',24,C.white,800);this.text(18,44,state.message,13,C.muted);this.text(w-18,18,`牌堆 ${state.variant.deckCount??0}`,12,C.muted,500,'right');this.drawSeats(w,h);this.drawCenter(w,h);this.drawHand(w,h);this.drawActions(w,h);if(state.settlement)this.drawSettlement(w,h)}
  private drawSeats(w:number,h:number){const seats=this.visualSeats(),n=seats.length,compact=n>=5,tiny=n>=7;seats.forEach((seat,index)=>{let x:number,y:number;if(index===0){x=w/2;y=h-118}else{const t=n===2?.5:(index-1)/Math.max(1,n-2),angle=Math.PI*(1-t);x=w/2+Math.cos(angle)*w*.39;y=h*.43-Math.sin(angle)*h*.26}const bw=tiny?86:compact?112:154,bh=tiny?38:compact?44:58,left=Math.max(5,Math.min(w-bw-5,x-bw/2)),top=Math.max(68,Math.min(h-160,y-bh/2)),turn=this.state!.currentPlayerId===seat.id;this.panel(left,top,bw,bh,turn?'#1d7d5f':C.panel,turn?C.gold:'#278262',.94);this.text(left+8,top+6,clip(`${seat.name}${seat.id===parti.playerId?'（你）':''}`,tiny?8:14),tiny?11:13,C.white,700);this.text(left+8,top+(tiny?22:30),`${seat.bot?'AI · ':seat.connected?'':'托管 · '}剩 ${seat.handCount} 张`,tiny?9:11,C.muted);if(index>0&&!tiny)this.cardBack(left+bw-34,top+8,25,bh-16,String(seat.handCount))})}
  private drawCenter(w:number,h:number){const s=this.state!,cy=h*.46;if(s.variantId==='doudizhu'&&s.variant.landlordCards?.length){this.text(w/2-76,82,'地主底牌',12,C.muted);s.variant.landlordCards.forEach((c,i)=>this.card(w/2-40+i*30,100,c,32,44,false))}if(s.lastPlay){const name=s.lastPlay.playerId==='table'?'起始牌':this.name(s.lastPlay.playerId);this.center(`${name}${s.lastPlay.analysis?` · ${s.lastPlay.analysis.label}`:''}`,w,cy-64,14,C.muted);this.cardLine(s.lastPlay.cards,w/2,cy-34,Math.min(48,w/12),66)}else if(s.phase==='playing')this.center('新一轮，等待出牌',w,cy-10,16,C.muted);if(s.variantId==='doudizhu')this.center(`倍数 x${s.variant.multiplier??1}`,w,cy+54,13,C.gold,700);if(s.variantId==='gandengyan')this.center(`炸弹 ${s.variant.bombs??0} · 牌堆 ${s.variant.deckCount??0}`,w,cy+54,13,C.gold,700);if(s.variantId==='chameleon')this.center(`当前：${suitText(s.variant.activeSuit!)} · ${rankText(s.variant.activeRank!)}`,w,cy+54,15,C.gold,800)}
  private drawHand(w:number,h:number){const hand=this.privateState.hand;if(!hand.length)return;const cw=Math.max(30,Math.min(68,w/11)),ch=cw*1.38,gap=Math.max(18,Math.min(cw*.68,(w-40-cw)/Math.max(1,hand.length-1))),total=cw+gap*(hand.length-1),start=(w-total)/2,y=h-ch-10;hand.forEach((card,index)=>{const selected=this.selected.has(card.id),x=start+index*gap,top=y-(selected?20:0);this.card(x,top,card,cw,ch,selected);this.handHits.push({x,y:top,w:index===hand.length-1?cw:gap,h:ch,cardId:card.id,index})})}
  private drawActions(w:number,h:number){const s=this.state!,me=this.me(),y=Math.max(104,h-(Math.max(30,Math.min(68,w/11))*1.38)-72);if(!me)return;if(s.phase==='bidding'&&s.variant.bid?.currentPlayerId===me.id){[0,1,2,3].forEach((score,i)=>this.button(w/2-178+i*90,y,78,40,score?`${score} 分`:'不叫',()=>void parti.action('playCards',{cardIds:[],choice:{score}}),score>0&&score<=s.variant.bid!.highestScore,13));return}if(s.phase!=='playing'||s.currentPlayerId!==me.id)return;if(s.variantId==='chameleon'){const selected=this.privateState.hand.find(c=>this.selected.has(c.id));if(selected?.rank===11){this.button(w/2-214,y-45,102,36,suitText(this.choiceSuit),()=>{this.choiceSuit=SUITS[(SUITS.indexOf(this.choiceSuit)+1)%SUITS.length]!},false,12);this.button(w/2-102,y-45,102,36,rankText(this.choiceRank),()=>{this.choiceRank=this.choiceRank%13+1},false,12)}this.button(w/2-104,y,96,42,'出牌',()=>this.play(),this.selected.size!==1,14);this.button(w/2+8,y,96,42,'摸牌',()=>void parti.action('drawCard'),!this.privateState.canDraw,14);return}this.button(w/2-130,y,112,42,'出牌',()=>this.play(),this.selected.size===0);this.button(w/2+18,y,112,42,'不出',()=>void parti.action('pass'),!this.privateState.canPass)}
  private drawSettlement(w:number,h:number){const result=this.state!.settlement!;this.panel(w/2-Math.min(210,w*.44),h*.2,Math.min(420,w*.88),Math.min(300,h*.58),'#051f19',C.gold,.97);this.center(result.title,w,h*.24,28,C.gold,800);this.center(result.detail,w,h*.24+40,14,C.muted);Object.entries(result.deltas).forEach(([id,delta],i)=>this.center(`${this.name(id)}  ${delta>=0?'+':''}${delta}`,w,h*.24+78+i*27,16,delta>=0?C.cyan:'#fda4af',700));if(this.state!.hostId===parti.playerId)this.button(w/2-76,h*.2+Math.min(248,h*.5),152,42,'返回大厅',()=>void parti.action('returnToLobby'))}
  private play(){const selected=[...this.selected],card=this.privateState.hand.find(c=>selected.includes(c.id)),choice=this.state?.variantId==='chameleon'&&card?.rank===11?{suit:this.choiceSuit,rank:this.choiceRank}:undefined;void parti.action('playCards',{cardIds:selected,choice})}
  private begin(card:HandHit){this.gesture={select:!this.selected.has(card.cardId),start:card.index,last:card.index,initial:new Set(this.selected)};this.apply(card.index)}private extend(index:number){if(!this.gesture||this.gesture.last===index)return;this.gesture.last=index;this.apply(index)}private apply(end:number){const g=this.gesture!;for(const hit of this.handHits){const inRange=hit.index>=Math.min(g.start,end)&&hit.index<=Math.max(g.start,end),selected=inRange?g.select:g.initial.has(hit.cardId);if(selected)this.selected.add(hit.cardId);else this.selected.delete(hit.cardId)}}
  private visualSeats(){const seats=this.state!.seats.filter((s):s is SeatState=>Boolean(s)),mySeat=this.me()?.seat??seats[0]?.seat??0;return [...seats].sort((a,b)=>((a.seat-mySeat+8)%8)-((b.seat-mySeat+8)%8))}
  private me(){return this.state?.seats.find(s=>s?.id===parti.playerId)??null}private name(id:string){const s=this.state?.seats.find(x=>x?.id===id);return s?.id===parti.playerId?'你':s?.name??'玩家'}private notice(message:string){this.flash=message;this.flashUntil=performance.now()+1800}
  private cardLine(cards:Card[],cx:number,y:number,w:number,h:number){const gap=Math.min(w*.62,30),start=cx-(w+gap*(cards.length-1))/2;cards.forEach((c,i)=>this.card(start+i*gap,y,c,w,h,false))}
  private card(x:number,y:number,card:Card,w:number,h:number,selected:boolean){const red=card.suit==='hearts'||card.suit==='diamonds'||card.suit==='joker';this.panel(x,y,w,h,selected?'#fff2bf':'#f8fafc',selected?C.gold:'#d4e8df');this.text(x+6,y+5,card.label,Math.max(12,w*.31),red?C.red:'#111827',800);this.text(x+7,y+h-Math.max(18,w*.31),suitText(card.suit),Math.max(11,w*.26),red?C.red:'#111827')}
  private cardBack(x:number,y:number,w:number,h:number,label:string){this.panel(x,y,w,h,'#9f1d2f','#fecaca');this.centerAt(x+w/2,y+h/2,label,12,C.white,700)}
  private button(x:number,y:number,w:number,h:number,label:string,onClick:()=>void,disabled=false,size=14){this.panel(x,y,w,h,disabled?'#38534b':C.gold,disabled?'#527166':'#ffe5a3');this.centerAt(x+w/2,y+h/2,label,size,disabled?'#9fb8af':'#1f2937',800);if(!disabled)this.hits.push({x,y,w,h,onClick})}
  private vignette(w:number,h:number){const c=mainContext,g=c.createRadialGradient(w/2,h*.48,20,w/2,h*.48,Math.max(w,h)*.65);g.addColorStop(0,'rgba(8,90,68,0)');g.addColorStop(1,'rgba(1,18,14,.72)');c.fillStyle=g;c.fillRect(0,0,w,h)}private panel(x:number,y:number,w:number,h:number,fill:string,stroke:string,alpha=1){const c=mainContext;c.save();c.globalAlpha=alpha;c.fillStyle=fill;c.fillRect(x,y,w,h);c.globalAlpha=1;c.strokeStyle=stroke;c.lineWidth=2;c.strokeRect(x+1,y+1,w-2,h-2);c.restore()}private text(x:number,y:number,value:string,size:number,color:string,weight:number|string=400,align:CanvasTextAlign='left'){const c=mainContext;c.font=`${weight} ${size}px system-ui,sans-serif`;c.fillStyle=color;c.textAlign=align;c.textBaseline='top';c.fillText(value,x,y)}private center(value:string,w:number,y:number,size:number,color:string,weight:number|string=400){this.centerAt(w/2,y,value,size,color,weight)}private centerAt(x:number,y:number,value:string,size:number,color:string,weight:number|string=400){const c=mainContext;c.font=`${weight} ${size}px system-ui,sans-serif`;c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.fillText(value,x,y)}
  private visibility=()=>{if(document.hidden)this.gesture=null};private destroy=()=>{for(const d of this.disposers.splice(0))d();document.removeEventListener('visibilitychange',this.visibility)}
}
function inside(r:Rect,x:number,y:number){return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h}function clip(value:string,n:number){return value.length>n?value.slice(0,n-1)+'…':value}function suitText(suit:Suit){return{spades:'♠ 黑桃',hearts:'♥ 红心',clubs:'♣ 梅花',diamonds:'♦ 方块',joker:'王'}[suit]}function rankText(rank:number){return rank===1?'A':rank===11?'J':rank===12?'Q':rank===13?'K':String(rank)}

// ===== AI agent 转述（迁移自旧 worker 侧 describe()/pokerObserve()，改为客户端本玩家视角）=====
function pokerOccupied(state: GameState): SeatState[] {
  return state.seats.filter((s): s is SeatState => Boolean(s)).sort((a, b) => a.seat - b.seat);
}
function pokerFindSeat(state: GameState, playerId: string): SeatState | null {
  return state.seats.find((s) => s?.id === playerId) ?? null;
}

function buildPokerGuide(state: GameState | null, priv: PrivateState, playerId: string | null) {
  if (!state || !playerId) return { summary: '超级扑克（多玩法）。', phase: 'connecting', narrative: '正在连接房间…', isYourTurn: false, availableActions: [] };
  const meta = state.variants.find((v) => v.id === state.variantId) ?? { name: state.variantId, rules: [] as string[] };
  const guide = {
    summary: `超级扑克（多玩法）。当前玩法：${meta.name}。可选：斗地主 / 干瞪眼 / 变色龙。`,
    objective: `按当前玩法规则先出完手牌或达成胜利条件得分。${meta.name}规则：${meta.rules.join('；')}。`,
    actions: [
      { name: 'selectVariant', description: '房主在大厅选择玩法。', payloadSchema: { type: 'object', properties: { variantId: { enum: ['doudizhu', 'gandengyan', 'chameleon'] } }, required: ['variantId'] } },
      { name: 'addBot', description: '房主在指定座位加入机器人。', payloadSchema: { type: 'object', properties: { seat: { type: 'integer' } }, required: ['seat'] } },
      { name: 'removeBot', description: '房主移除指定座位的机器人。', payloadSchema: { type: 'object', properties: { seat: { type: 'integer' } }, required: ['seat'] } },
      { name: 'setReady', description: '大厅内准备/取消准备。', payloadSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'] }, examples: [{ ready: true }] },
      { name: 'startGame', description: '房主在所有真人准备后开局。', payloadSchema: { type: 'null' } },
      { name: 'playCards', description: '多用途出牌动作。斗地主叫分阶段传 {choice:{score:0-3}}（0=不叫）；出牌阶段传 {cardIds:[...]}，变色龙出 J 时另需 {choice:{suit,rank}}。', payloadSchema: { type: 'object', properties: { cardIds: { type: 'array', items: { type: 'string' } }, choice: { type: 'object' } } } },
      { name: 'pass', description: '跟牌阶段选择不出（斗地主/干瞪眼；变色龙无此动作）。', payloadSchema: { type: 'null' } },
      { name: 'drawCard', description: '变色龙无牌可出时摸一张。', payloadSchema: { type: 'null' } },
      { name: 'syncPrivate', description: '请求重发自己的手牌。', payloadSchema: { type: 'null' } },
      { name: 'returnToLobby', description: '房主在结算后返回大厅。', payloadSchema: { type: 'null' } },
    ],
    glossary: {
      phase: 'lobby=大厅, dealing=发牌, bidding=叫地主, playing=出牌中, settlement=结算',
      variantId: '当前玩法 doudizhu/gandengyan/chameleon。',
      currentPlayerId: '当前该行动的玩家 id。',
      lastPlay: '桌面上一手 {playerId, cards, analysis?, choice?}。',
      'variant.bid': '斗地主叫分状态。',
      'variant.activeSuit': '变色龙当前需匹配的花色。',
      'variant.activeRank': '变色龙当前需匹配的点数。',
      'variant.multiplier': '斗地主当前倍数。',
      role: 'landlord=地主, farmer=农民, null=未定（仅斗地主）。',
    },
  };

  const seat = pokerFindSeat(state, playerId);
  if (!seat) return { ...guide, phase: state.phase, narrative: '你当前不在座位上，正在旁观。', isYourTurn: false, availableActions: [], waitingFor: '等待入座' };
  const hand = priv.hand ?? [];
  const handStr = hand.length ? hand.map((card) => `${card.label}#${card.id}`).join(' ') : '（无）';
  const counts = pokerOccupied(state).map((s) => `${s.name}${s.role === 'landlord' ? '(地主)' : ''}:${s.handCount}张`).join('，');
  const base = `玩法 ${meta.name}。你（${seat.name}）手牌：${handStr}。各家剩余：${counts}。`;

  if (state.phase === 'lobby') {
    const isHost = state.hostId === playerId;
    const actions: Array<Record<string, unknown>> = [{ name: 'setReady', hint: seat.ready ? '已准备，可取消' : '准备开始', payloadSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'] } }];
    if (isHost) actions.push({ name: 'selectVariant', hint: '选择玩法' }, { name: 'addBot', hint: '加入机器人' }, { name: 'removeBot', hint: '移除机器人' }, { name: 'startGame', hint: '所有真人准备后开局' });
    return { ...guide, phase: 'lobby', narrative: `${base} ${state.message}`, isYourTurn: !seat.ready, availableActions: actions, waitingFor: seat.ready && !isHost ? '等待房主开局' : undefined };
  }

  if (state.phase === 'bidding') {
    const bid = state.variant.bid;
    if (!bid || state.currentPlayerId !== playerId) {
      const cur = state.currentPlayerId ? pokerFindSeat(state, state.currentPlayerId)?.name ?? '其他玩家' : '其他玩家';
      return { ...guide, phase: 'bidding', narrative: `${base} 当前最高分 ${bid?.highestScore ?? 0}，轮到 ${cur} 叫分。`, isYourTurn: false, availableActions: [], waitingFor: `等待 ${cur} 叫分` };
    }
    const scores = [0];
    for (let s = bid.highestScore + 1; s <= 3; s += 1) scores.push(s);
    return { ...guide, phase: 'bidding', narrative: `${base} 轮到你叫分，当前最高分 ${bid.highestScore}。0=不叫。`, isYourTurn: true, availableActions: [{ name: 'playCards', hint: '叫分：传 {choice:{score}}', payloadSchema: { type: 'object', properties: { choice: { type: 'object', properties: { score: { enum: scores } }, required: ['score'] } }, required: ['choice'] } }] };
  }

  if (state.phase === 'playing') {
    if (state.currentPlayerId !== playerId) {
      const cur = state.currentPlayerId ? pokerFindSeat(state, state.currentPlayerId)?.name ?? '其他玩家' : '其他玩家';
      return { ...guide, phase: 'playing', narrative: `${base} 轮到 ${cur} 行动。`, isYourTurn: false, availableActions: [], waitingFor: `等待 ${cur} 出牌` };
    }
    const lastStr = state.lastPlay && state.lastPlay.playerId !== 'table' ? `${pokerFindSeat(state, state.lastPlay.playerId)?.name ?? '?'} 出了 ${state.lastPlay.analysis?.label ?? ''}` : '无';
    if (state.variantId === 'chameleon') {
      const suit = state.variant.activeSuit!, rank = state.variant.activeRank!;
      const legalCards = hand.filter((card) => isChameleonLegal(card, suit, rank));
      if (!legalCards.length) return { ...guide, phase: 'playing', narrative: `${base} 当前需匹配 花色/点数=${suit}/${rank}，你无牌可出。`, isYourTurn: true, availableActions: [{ name: 'drawCard', hint: '无牌可出，摸一张' }] };
      const hasJoker = legalCards.some((card) => card.rank === 11);
      return { ...guide, phase: 'playing', narrative: `${base} 当前需匹配 花色/点数=${suit}/${rank}。可出：${legalCards.map((c) => `${c.label}#${c.id}`).join(' ')}。`, isYourTurn: true, availableActions: [{ name: 'playCards', hint: hasJoker ? '出一张同花色/同点数的牌；出 J(变色龙) 需附 {choice:{suit,rank}}' : '出一张同花色/同点数的牌', payloadSchema: { type: 'object', properties: { cardIds: { type: 'array', items: { enum: legalCards.map((c) => c.id) }, minItems: 1, maxItems: 1 }, choice: { type: 'object', properties: { suit: { enum: ['spades', 'hearts', 'clubs', 'diamonds'] }, rank: { type: 'integer', minimum: 1, maximum: 13 } } } }, required: ['cardIds'] }, examples: legalCards.slice(0, 4).map((c) => ({ cardIds: [c.id] })) }] };
    }
    const previous: PlayAnalysis | null = state.lastPlay?.analysis ?? null;
    const legal = state.variantId === 'doudizhu' ? enumerateDoudizhu(hand, previous) : enumerateGandengyan(hand, previous);
    const seatNow = pokerFindSeat(state, playerId);
    const canPass = Boolean(state.lastPlay && state.lastPlay.playerId !== playerId && seatNow);
    const actions: Array<Record<string, unknown>> = [{ name: 'playCards', hint: legal.length ? `可出 ${legal.length} 种合法牌型，从手牌选 cardIds` : '当前无更大牌型，可选择不出', payloadSchema: { type: 'object', properties: { cardIds: { type: 'array', items: { enum: hand.map((c) => c.id) } } }, required: ['cardIds'] }, examples: legal.slice(0, 6).map((cards) => ({ cardIds: cards.map((c) => c.id) })) }];
    if (canPass) actions.push({ name: 'pass', hint: '本轮不出' });
    return { ...guide, phase: 'playing', narrative: `${base} 上一手：${lastStr}。轮到你出牌。`, isYourTurn: true, availableActions: actions };
  }

  if (state.phase === 'settlement') {
    const isHost = state.hostId === playerId;
    return { ...guide, phase: 'settlement', narrative: `${base} ${state.message}`, isYourTurn: isHost, availableActions: isHost ? [{ name: 'returnToLobby', hint: '返回大厅' }] : [], waitingFor: isHost ? undefined : '等待房主返回大厅' };
  }

  return { ...guide, phase: state.phase, narrative: `${base} ${state.message}`, isYourTurn: false, availableActions: [], waitingFor: '请稍候' };
}
