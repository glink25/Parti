import { engineInit, mainCanvas, mainContext, setInputPreventDefault, setTouchInputEnable } from 'littlejsengine';
import { MAPS, getMap } from './game/maps';
import { bombFuseFor } from './game/rules';
import type { Direction, GameState, PlayerState, PowerupType } from './game/types';
import './style.css';
import './combat.css';

const app=document.querySelector<HTMLDivElement>('#app')!;
document.querySelector('#game')?.remove();
let state:GameState|undefined;
let sent:Direction={dx:0,dy:0};
let audio:AudioContext|undefined;
let combatShell:HTMLElement|undefined;
let lobbyShell:HTMLElement|undefined;
const keys=new Set<string>();
const visualPositions=new Map<string,{x:number;y:number}>();
const visualBombPositions=new Map<string,{x:number;y:number}>();
let lastFrameAt=performance.now();
let pickupToastTimer:number|undefined;
const colors=['#58d6ff','#ff657a','#ffd95a','#8def72'];
const themeColors={garden:['#132f28','#295744','#73a96c'],frost:['#132a42','#28618a','#a8ecff'],volcano:['#32171d','#7f2e27','#ff9b45'],neon:['#17142e','#33295f','#d64cff']} as const;

function action(name:string,payload?:unknown){void parti.action(name,payload);}
function sound(kind:'bomb'|'detonate') { try { audio??=new AudioContext();const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;oscillator.type=kind==='bomb'?'square':'sawtooth';oscillator.frequency.setValueAtTime(kind==='bomb'?180:520,now);oscillator.frequency.exponentialRampToValueAtTime(kind==='bomb'?90:70,now+.14);gain.gain.setValueAtTime(.055,now);gain.gain.exponentialRampToValueAtTime(.001,now+.15);oscillator.connect(gain).connect(audio.destination);oscillator.start(now);oscillator.stop(now+.16);} catch { /* Audio is optional in restricted browsers. */ } }
function me(){return state&&parti.playerId?state.players[parti.playerId]:undefined;}
function isHost(){return state?.hostId===parti.playerId;}
function timeLeft(){if(!state)return 0;const end=state.phase==='overtime'?state.overtimeEndsAt:state.endsAt;return Math.max(0,Math.ceil((end-Date.now())/1000));}

function renderDom(){
  if(!state)return;
  if(state.phase==='lobby') {
    if(!lobbyShell) createLobbyShell();
    updateLobbyShell();
    return;
  }
  if(!combatShell) createCombatShell();
  updateCombatShell();
}

function createLobbyShell(){
  combatShell=undefined;
  app.replaceChildren();
  const panel=document.createElement('main');panel.className='lobby panel';
  panel.innerHTML=`<header class="lobby-hero"><div><div class="brand"><span class="brand-mark">✹</span><div><p>PARTI ARENA</p><h1>爆破派对</h1></div></div><p class="lead">放置炸弹，炸开捷径，在三分钟内抢下最高分。</p></div></header>
  <section><div class="section-title"><h2>参战席位</h2><span class="seat-count">0/4</span></div><div class="roster"></div></section>
  <section class="map-select"><div class="section-title"><h2>竞技场</h2><span>8 张地图</span></div><div class="maps"></div></section>
  <footer class="lobby-actions"><button class="ready-button">准备迎战</button><button class="start-button">开始比赛</button></footer>`;
  const maps=panel.querySelector('.maps')!;
  MAPS.forEach(map=>{const button=document.createElement('button');button.dataset.mapId=map.id;button.className=`map-card theme-${map.theme}`;button.innerHTML=`<span class="map-preview">${map.rows.slice(1,10).map(r=>`<i>${r.slice(1,12).replaceAll('#','■').replaceAll('+','▪').replaceAll('.','·')}</i>`).join('')}</span><strong>${map.name}</strong><small>${map.theme==='garden'?'苔庭':map.theme==='frost'?'冰境':map.theme==='volcano'?'熔岩':'霓虹'}</small>`;button.onclick=()=>action('lobby:set-map',{mapId:map.id});maps.append(button);});
  const ready=panel.querySelector<HTMLButtonElement>('.ready-button')!;ready.onclick=()=>{const player=me();if(player)action('lobby:set-ready',{ready:!player.ready})};
  panel.querySelector<HTMLButtonElement>('.start-button')!.onclick=()=>action('game:start');
  app.append(panel);lobbyShell=panel;
}

function createPlayerRow(player:PlayerState){
  const row=document.createElement('div');row.className='player-row';row.dataset.playerId=player.id;
  row.innerHTML='<i></i><strong></strong><small></small><b></b>';
  if(player.bot){const select=document.createElement('select');select.innerHTML='<option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option>';select.onchange=()=>action('lobby:set-bot-difficulty',{botId:player.id,difficulty:select.value});row.append(select);const remove=document.createElement('button');remove.className='icon-button';remove.textContent='×';remove.onclick=()=>action('lobby:remove-bot',{botId:player.id});row.append(remove);}
  return row;
}

function updateLobbyShell(){
  const players=Object.values(state!.players),roster=lobbyShell!.querySelector<HTMLElement>('.roster')!;
  lobbyShell!.querySelector<HTMLElement>('.seat-count')!.textContent=`${players.length}/4`;
  for(const player of players){let row=roster.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(player.id)}"]`);if(!row){row=createPlayerRow(player);roster.append(row)}row.querySelector<HTMLElement>('i')!.style.setProperty('--player',colors[player.color]);row.querySelector('strong')!.textContent=player.name;row.querySelector('small')!.textContent=player.bot?`机器人 · ${player.difficulty==='easy'?'简单':player.difficulty==='hard'?'困难':'普通'}`:player.id===state!.hostId?'房主':'玩家';const badge=row.querySelector('b')!;badge.classList.toggle('ready',player.ready);badge.textContent=player.ready?'已准备':'等待中';const select=row.querySelector<HTMLSelectElement>('select');if(select){select.value=player.difficulty??'normal';select.hidden=!isHost()}const remove=row.querySelector<HTMLButtonElement>('.icon-button');if(remove)remove.hidden=!isHost();}
  roster.querySelectorAll<HTMLElement>('[data-player-id]').forEach(row=>{if(!state!.players[row.dataset.playerId!])row.remove()});
  let add=roster.querySelector<HTMLButtonElement>('.add-bot');if(!add){add=document.createElement('button');add.className='add-bot';add.textContent='+ 添加机器人';add.onclick=()=>action('lobby:add-bot',{difficulty:'normal'});roster.append(add)}add.hidden=!isHost()||players.length>=4;
  lobbyShell!.querySelectorAll<HTMLButtonElement>('.map-card').forEach(button=>{button.disabled=!isHost();button.classList.toggle('selected',button.dataset.mapId===state!.mapId)});
  const player=me(),ready=lobbyShell!.querySelector<HTMLButtonElement>('.ready-button')!;ready.hidden=!player||player.bot;ready.classList.toggle('cancel',Boolean(player?.ready));ready.textContent=player?.ready?'取消准备':'准备迎战';
  const start=lobbyShell!.querySelector<HTMLButtonElement>('.start-button')!,humans=players.filter(p=>!p.bot);start.hidden=!isHost();start.disabled=players.length<2||humans.some(p=>!p.ready);
}

function createCombatShell(){
  lobbyShell=undefined;
  const fragment=document.createRange().createContextualFragment(`<div class="hud"><div class="corner-info"><div class="timer"><small>剩余</small><strong>3:00</strong></div><div class="stats"></div><details class="powerup-guide"><summary>道具说明</summary><div><span>🔥 火力</span><small>爆炸范围 +1</small><span>💣 扩容</span><small>同时放置 +1</small><span>⚡ 加速</span><small>提高移动速度</small><span>👢 踢弹</span><small>推动前方炸弹</small><span>📡 遥控</span><small>主动引爆炸弹</small></div></details></div><div class="pickup-toast" hidden></div><div class="scores"></div><div class="result panel" hidden></div></div><div class="touch-controls"><div class="joystick" aria-label="移动摇杆"><i></i></div><div class="action-buttons"><button class="bomb" aria-label="放置炸弹">💣<small>放置</small></button><button class="remote" aria-label="遥控引爆">⚡<small>引爆</small></button></div></div>`);
  app.replaceChildren(fragment);
  combatShell=app.firstElementChild as HTMLElement;
  const controls=app.querySelector<HTMLElement>('.touch-controls')!;
  setupJoystick(controls.querySelector<HTMLElement>('.joystick')!);
  controls.querySelector<HTMLButtonElement>('.bomb')!.onpointerdown=e=>{e.preventDefault();sound('bomb');action('player:place-bomb')};
  controls.querySelector<HTMLButtonElement>('.remote')!.onpointerdown=e=>{e.preventDefault();sound('detonate');action('player:detonate')};
}

function updateCombatShell(){
  const ranking=Object.values(state!.players).filter(p=>!p.waiting).sort((a,b)=>b.score-a.score);
  const timer=app.querySelector<HTMLElement>('.timer')!;timer.classList.toggle('overtime',state!.phase==='overtime');timer.innerHTML=`<small>${state!.phase==='overtime'?'加时':'剩余'}</small><strong>${Math.floor(timeLeft()/60)}:${String(timeLeft()%60).padStart(2,'0')}</strong>`;
  app.querySelector<HTMLElement>('.scores')!.innerHTML=ranking.map((p,i)=>`<span class="${p.id===parti.playerId?'self':''}" style="--player:${colors[p.color]}"><i>${i+1}</i><b>${p.name}</b><strong>${p.score}</strong></span>`).join('');
  const player=me();app.querySelector<HTMLElement>('.stats')!.innerHTML=player?`<span title="火力">🔥${player.flame}</span><span title="炸弹容量">💣${player.capacity}</span><span title="速度">⚡${player.speed}</span>${player.kick?'<span title="踢弹">👢</span>':''}${player.remote?'<span title="遥控">📡</span>':''}`:'';
  const controls=app.querySelector<HTMLElement>('.touch-controls')!;controls.hidden=!player||player.waiting||!['playing','overtime'].includes(state!.phase);controls.querySelector<HTMLElement>('.remote')!.hidden=!player?.remote;
  const result=app.querySelector<HTMLElement>('.result')!;result.hidden=state!.phase!=='finished';
  if(state!.phase==='finished'){const names=state!.winners.map(id=>state!.players[id]?.name).filter(Boolean).join('、');result.innerHTML=`<p>比赛结束</p><h2>${names||'无人'} 获胜</h2><ol>${ranking.map(p=>`<li><span>${p.name}</span><strong>${p.score} 分</strong></li>`).join('')}</ol>${isHost()?'<button id="return">返回大厅</button>':'<small>等待房主返回大厅</small>'}`;result.querySelector<HTMLButtonElement>('#return')?.addEventListener('click',()=>action('game:return-to-lobby'),{once:true});}
}

function setupJoystick(base:HTMLElement){
  const nub=base.querySelector<HTMLElement>('i')!;let pointer:number|undefined;
  const release=(event?:PointerEvent)=>{if(event&&pointer!==event.pointerId)return;pointer=undefined;nub.style.transform='';base.classList.remove('active');sendDirection({dx:0,dy:0});};
  const move=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;event.preventDefault();const rect=base.getBoundingClientRect(),x=event.clientX-(rect.left+rect.width/2),y=event.clientY-(rect.top+rect.height/2),distance=Math.hypot(x,y),limit=rect.width*.28,scale=distance>limit?limit/distance:1;nub.style.transform=`translate(${x*scale}px,${y*scale}px)`;const deadzone=rect.width*.1;sendDirection(distance<deadzone?{dx:0,dy:0}:Math.abs(x)>Math.abs(y)?{dx:x>0?1:-1,dy:0}:{dx:0,dy:y>0?1:-1});};
  base.onpointerdown=event=>{if(pointer!==undefined)return;pointer=event.pointerId;base.classList.add('active');base.setPointerCapture(event.pointerId);move(event)};
  base.onpointermove=move;base.onpointerup=release;base.onpointercancel=release;base.onlostpointercapture=()=>release();
  addEventListener('blur',()=>release());document.addEventListener('visibilitychange',()=>{if(document.hidden)release()});
}
function sendDirection(next:Direction){if(next.dx===sent.dx&&next.dy===sent.dy)return;sent=next;action('player:move',next);}

function updateInput(){let dx=0,dy=0;if(keys.has('arrowleft')||keys.has('a'))dx=-1;else if(keys.has('arrowright')||keys.has('d'))dx=1;else if(keys.has('arrowup')||keys.has('w'))dy=-1;else if(keys.has('arrowdown')||keys.has('s'))dy=1;sendDirection({dx:dx as -1|0|1,dy:dy as -1|0|1});}
addEventListener('keydown',e=>{const key=e.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown',' ','w','a','s','d','e'].includes(key))e.preventDefault();keys.add(key);if(!e.repeat&&key===' '){sound('bomb');action('player:place-bomb')}if(!e.repeat&&key==='e'){sound('detonate');action('player:detonate')}updateInput()});addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());updateInput()});

function gameRender(){
  if(!state||state.phase==='lobby'||!mainContext||!mainCanvas)return;
  const ctx=mainContext,canvas=mainCanvas,map=getMap(state.mapId),palette=themeColors[map.theme];const tile=Math.floor(Math.min(canvas.width/13,canvas.height/11)),ox=(canvas.width-tile*13)/2,oy=(canvas.height-tile*11)/2;
  ctx.imageSmoothingEnabled=false;ctx.fillStyle=palette[0];ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let y=0;y<11;y++)for(let x=0;x<13;x++){const value=map.rows[y][x],destroyed=state.destroyed.includes(`${x},${y}`);drawTile(ctx,ox+x*tile,oy+y*tile,tile,value,destroyed,palette);}
  const animation=performance.now(),dt=Math.min(50,animation-lastFrameAt);lastFrameAt=animation;
  for(const item of state.powerups)drawPowerup(ctx,ox+(item.x+.5)*tile,oy+(item.y+.5)*tile,tile,item.type,animation);
  const bombIds=new Set(state.bombs.map(bomb=>bomb.id));for(const id of visualBombPositions.keys())if(!bombIds.has(id))visualBombPositions.delete(id);
  for(const bomb of state.bombs){let visual=visualBombPositions.get(bomb.id);if(!visual||Math.abs(visual.x-bomb.x)>2||Math.abs(visual.y-bomb.y)>2){visual={x:bomb.x,y:bomb.y};visualBombPositions.set(bomb.id,visual)}const step=dt/100;visual.x+=Math.max(-step,Math.min(step,bomb.x-visual.x));visual.y+=Math.max(-step,Math.min(step,bomb.y-visual.y));drawBomb(ctx,ox+(visual.x+.5)*tile,oy+(visual.y+.5)*tile,tile,bomb);}
  for(const flame of state.flames)for(const c of flame.cells)drawFlame(ctx,ox+(c.x+.5)*tile,oy+(c.y+.5)*tile,tile,animation);
  for(const player of Object.values(state.players).filter(p=>!p.waiting&&p.alive)){let visual=visualPositions.get(player.id);if(!visual||Math.abs(visual.x-player.x)>2||Math.abs(visual.y-player.y)>2){visual={x:player.x,y:player.y};visualPositions.set(player.id,visual);}const duration=player.bot?(player.difficulty==='easy'?420:player.difficulty==='hard'?280:340):Math.max(100,260-player.speed*40),step=dt/duration;visual.x+=Math.max(-step,Math.min(step,player.x-visual.x));visual.y+=Math.max(-step,Math.min(step,player.y-visual.y));ctx.globalAlpha=player.invulnerableUntil>Date.now()&&Math.floor(performance.now()/100)%2?0.45:1;drawPlayer(ctx,ox+(visual.x+.5)*tile,oy+(visual.y+.5)*tile,tile,player);ctx.globalAlpha=1;}
}
function drawTile(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,value:string,destroyed:boolean,palette:readonly string[]){ctx.fillStyle='#182332';ctx.fillRect(x+1,y+1,size-2,size-2);if(value==='#'){ctx.fillStyle=palette[1];ctx.fillRect(x+2,y+2,size-4,size-4);ctx.fillStyle='#ffffff30';ctx.fillRect(x+4,y+4,size-8,Math.max(3,size*.1));ctx.fillStyle='#00000035';ctx.fillRect(x+size*.12,y+size*.76,size*.76,size*.12);ctx.strokeStyle='#00000055';ctx.lineWidth=Math.max(1,size*.05);ctx.strokeRect(x+size*.17,y+size*.17,size*.66,size*.66);}else if(value==='+'&&!destroyed){ctx.fillStyle=palette[2];ctx.fillRect(x+size*.08,y+size*.08,size*.84,size*.84);ctx.fillStyle='#00000045';ctx.fillRect(x+size*.14,y+size*.68,size*.72,size*.16);ctx.strokeStyle='#ffffff45';ctx.lineWidth=Math.max(2,size*.08);ctx.beginPath();ctx.moveTo(x+size*.2,y+size*.2);ctx.lineTo(x+size*.8,y+size*.8);ctx.moveTo(x+size*.8,y+size*.2);ctx.lineTo(x+size*.2,y+size*.8);ctx.stroke();}}
function drawBomb(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,bomb:GameState['bombs'][number]){const owner=state?.players[bomb.ownerId],fuse=bombFuseFor(bomb.remote),remaining=Math.max(0,bomb.explodeAt-Date.now()),age=Math.max(0,fuse-remaining),warning=Math.max(0,Math.min(1,(1000-remaining)/1000)),easedWarning=warning*warning*(3-2*warning),phase=age*.005+easedWarning*easedWarning*8,pulse=1+Math.sin(phase)*(.035+easedWarning*.045);ctx.save();ctx.translate(x,y);ctx.scale(pulse,pulse);ctx.fillStyle=bomb.remote?'#102b3b':'#0a0d13';ctx.beginPath();ctx.arc(0,size*.04,size*.31,0,Math.PI*2);ctx.fill();ctx.strokeStyle=bomb.remote?'#55eaff':remaining<700?'#ff5c4d':'#778497';ctx.lineWidth=Math.max(2,size*.07);ctx.stroke();ctx.fillStyle='#566171';ctx.fillRect(-size*.1,-size*.34,size*.2,size*.12);if(bomb.remote){ctx.strokeStyle=owner?colors[owner.color]:'#55eaff';ctx.lineWidth=Math.max(2,size*.05);ctx.beginPath();ctx.moveTo(0,-size*.33);ctx.lineTo(size*.13,-size*.48);ctx.stroke();ctx.fillStyle=remaining<700?'#fff36a':'#70f5ff';ctx.fillRect(size*.09,-size*.53,size*.1,size*.1);ctx.strokeStyle=owner?colors[owner.color]:'#fff';ctx.lineWidth=Math.max(1,size*.04);ctx.beginPath();ctx.arc(0,size*.04,size*.39,0,Math.PI*2);ctx.stroke();}else{ctx.strokeStyle='#d98d36';ctx.lineWidth=Math.max(2,size*.06);ctx.beginPath();ctx.moveTo(0,-size*.34);ctx.quadraticCurveTo(size*.2,-size*.5,size*.25,-size*.35);ctx.stroke();ctx.fillStyle=remaining<700?'#fff36a':'#ff9f38';ctx.fillRect(size*.2,-size*.42,size*.12,size*.12);}ctx.restore();}
function drawFlame(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,now:number){const wave=.65+Math.sin(now*.035+x+y)*.12;ctx.fillStyle='#ff5a24';ctx.fillRect(x-size*.42,y-size*.42,size*.84,size*.84);ctx.fillStyle='#ffad32';ctx.fillRect(x-size*wave/2,y-size*wave/2,size*wave,size*wave);ctx.fillStyle='#fff28a';ctx.fillRect(x-size*.17,y-size*.17,size*.34,size*.34);}
function drawPowerup(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,type:PowerupType,now:number){const bob=Math.sin(now*.006+x)*size*.06,fill={flame:'#ff6547',capacity:'#47536a',speed:'#ffe65c',kick:'#b083ff',remote:'#51eaff'}[type];ctx.save();ctx.translate(x,y+bob);ctx.fillStyle='#07101dcc';ctx.fillRect(-size*.32,-size*.32,size*.64,size*.64);ctx.strokeStyle=fill;ctx.lineWidth=Math.max(2,size*.07);ctx.strokeRect(-size*.27,-size*.27,size*.54,size*.54);ctx.fillStyle=fill;if(type==='flame'){ctx.beginPath();ctx.moveTo(0,-size*.22);ctx.lineTo(size*.18,size*.18);ctx.lineTo(0,size*.1);ctx.lineTo(-size*.18,size*.18);ctx.closePath();ctx.fill();ctx.fillStyle='#fff09a';ctx.fillRect(-size*.05,0,size*.1,size*.14);}else if(type==='capacity'){ctx.beginPath();ctx.arc(-size*.04,size*.03,size*.15,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffbd45';ctx.fillRect(size*.03,-size*.2,size*.08,size*.12);ctx.fillStyle='#fff';ctx.fillRect(size*.09,-size*.04,size*.16,size*.06);ctx.fillRect(size*.14,-size*.09,size*.06,size*.16);}else if(type==='speed'){ctx.beginPath();ctx.moveTo(-size*.22,-size*.18);ctx.lineTo(0,0);ctx.lineTo(-size*.22,size*.18);ctx.lineTo(-size*.08,size*.18);ctx.lineTo(size*.14,0);ctx.lineTo(-size*.08,-size*.18);ctx.closePath();ctx.fill();}else if(type==='kick'){ctx.fillRect(-size*.16,-size*.2,size*.14,size*.3);ctx.fillRect(-size*.12,size*.04,size*.32,size*.14);ctx.fillStyle='#fff';ctx.fillRect(size*.1,size*.05,size*.1,size*.05);}else{ctx.fillRect(-size*.05,-size*.03,size*.1,size*.22);ctx.fillRect(-size*.14,size*.13,size*.28,size*.08);ctx.strokeStyle=fill;ctx.beginPath();ctx.arc(0,-size*.08,size*.12,Math.PI*1.15,Math.PI*1.85);ctx.stroke();ctx.beginPath();ctx.arc(0,-size*.08,size*.22,Math.PI*1.15,Math.PI*1.85);ctx.stroke();}ctx.restore();}
function drawPlayer(ctx:CanvasRenderingContext2D,x:number,y:number,tile:number,p:PlayerState){const bob=Math.sin(performance.now()*.012+p.color)*tile*.035;ctx.save();ctx.translate(0,bob);ctx.fillStyle='#0006';ctx.fillRect(x-tile*.25,y+tile*.23,tile*.5,tile*.12);ctx.fillStyle=colors[p.color];ctx.fillRect(x-tile*.28,y-tile*.27,tile*.56,tile*.5);ctx.fillStyle='#f4dcc5';ctx.fillRect(x-tile*.2,y-tile*.34,tile*.4,tile*.25);ctx.fillStyle='#18202c';ctx.fillRect(x-tile*.13,y-tile*.27,tile*.06,tile*.07);ctx.fillRect(x+tile*.07,y-tile*.27,tile*.06,tile*.07);if(p.id===parti.playerId){ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(2,tile*.05);ctx.strokeRect(x-tile*.33,y-tile*.39,tile*.66,tile*.7);}ctx.restore();}

function showPickupFeedback(previous:GameState|undefined,next:GameState){if(!parti.playerId)return;const before=previous?.players[parti.playerId],after=next.players[parti.playerId];if(!before||!after||!after.alive)return;let message='';if(after.flame>before.flame)message='🔥 火力提升：爆炸范围 +1';else if(after.capacity>before.capacity)message='💣 炸弹扩容：可同时放置 +1';else if(after.speed>before.speed)message='⚡ 速度提升：移动更快';else if(after.kick&&!before.kick)message='👢 踢弹：推动前方炸弹';else if(after.remote&&!before.remote)message='📡 遥控：主动引爆遥控炸弹';if(!message)return;queueMicrotask(()=>{const toast=app.querySelector<HTMLElement>('.pickup-toast');if(!toast)return;toast.textContent=message;toast.hidden=false;if(pickupToastTimer)clearTimeout(pickupToastTimer);pickupToastTimer=window.setTimeout(()=>{toast.hidden=true},1800)});}

parti.onState(next=>{const previous=state;state=next;if(state.phase==='lobby'){visualPositions.clear();visualBombPositions.clear()}renderDom();showPickupFeedback(previous,next)});
parti.ready();
// LittleJS is used for its render loop only. Its document-level input handlers
// otherwise prevent default events for the HTML lobby and compete with our joystick.
setInputPreventDefault(false);
setTouchInputEnable(false);
engineInit(()=>{},()=>{},()=>{},gameRender,()=>{},[]);
