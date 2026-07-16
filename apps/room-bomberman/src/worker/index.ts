import { defineRoom } from '@parti/worker-sdk';
import { MAPS, cellKey, getMap } from '../game/maps';
import { applyPowerup, BASE_CAPACITY, BASE_FLAME, BASE_SPEED, blastCells, bombFuseFor, canBombMoveTo, canMove, chooseBotDirection, deterministicDropRoll, INVULNERABLE_MS, KICKED_BOMB_STEP_MS, leaders, MATCH_MS, moveDelayFor, OVERTIME_MS, playerSpawn, powerupDropForRoll, removePowerupsInCells, resetPlayerAbilities, RESPAWN_MS } from '../game/rules';
import type { Difficulty, GameState, PlayerState } from '../game/types';

const TICK_MS = 50;
const BOT_NAMES = ['铜钉', '火花', '齿轮'];
let sequence = 0;

const freshPlayer = (id:string,name:string,color:number,bot=false,difficulty?:Difficulty):PlayerState => ({
  id,name,bot,difficulty,ready:bot,connected:true,waiting:false,x:1,y:1,input:{dx:0,dy:0},alive:true,score:0,deaths:0,
  flame:BASE_FLAME,capacity:BASE_CAPACITY,speed:BASE_SPEED,kick:false,remote:false,respawnAt:0,invulnerableUntil:0,nextMoveAt:0,color,spawnIndex:color,
});

function resetRound(state:GameState, now:number) {
  state.bombs=[]; state.flames=[]; state.powerups=[]; state.destroyed=[]; state.winners=[]; state.overtimeLeaders=[];
  state.startedAt=now; state.endsAt=now+MATCH_MS; state.overtimeEndsAt=0; state.tick=0;
  const map=getMap(state.mapId);
  Object.values(state.players).filter(p=>!p.waiting).forEach((p,index)=>Object.assign(p, freshPlayer(p.id,p.name,p.color,p.bot,p.difficulty), {ready:p.ready,connected:p.connected,score:0,spawnIndex:index%4,x:map.spawns[index%4].x,y:map.spawns[index%4].y}));
}

function explode(state:GameState,bombId:string,now:number) {
  const bomb=state.bombs.find(b=>b.id===bombId); if(!bomb) return;
  const cells=blastCells(state,bomb); state.bombs=state.bombs.filter(b=>b.id!==bombId);
  const flameId=`flame-${++sequence}`; state.flames.push({id:flameId,ownerId:bomb.ownerId,cells,expiresAt:now+550});
  state.powerups=removePowerupsInCells(state.powerups,cells);
  for(const cell of cells){
    const key=cellKey(cell.x,cell.y); const map=getMap(state.mapId);
    if(map.rows[cell.y]?.[cell.x]==='+'&&!state.destroyed.includes(key)){
      state.destroyed.push(key);
      const type=powerupDropForRoll(deterministicDropRoll(cell.x,cell.y,state.tick));
      if(type) state.powerups.push({id:`item-${++sequence}`,type,x:cell.x,y:cell.y});
    }
    state.bombs.filter(next=>next.x===cell.x&&next.y===cell.y).forEach(next=>explode(state,next.id,now));
  }
}

function placeBomb(state:GameState, player:PlayerState, now:number) {
  if(!player.alive||state.bombs.some(b=>b.x===player.x&&b.y===player.y)) return;
  if(state.bombs.filter(b=>b.ownerId===player.id).length>=player.capacity) return;
  state.bombs.push({id:`bomb-${++sequence}`,ownerId:player.id,x:player.x,y:player.y,flame:player.flame,explodeAt:now+bombFuseFor(player.remote),remote:player.remote,motion:{dx:0,dy:0},nextMoveAt:0});
}

function eliminate(state:GameState, victim:PlayerState, ownerId:string, now:number) {
  if(!victim.alive||victim.invulnerableUntil>now) return;
  victim.alive=false; victim.deaths++; victim.respawnAt=now+RESPAWN_MS; victim.input={dx:0,dy:0};resetPlayerAbilities(victim);
  if(ownerId!==victim.id && state.players[ownerId]) {
    state.players[ownerId].score++;
    if(state.phase==='overtime'&&state.overtimeLeaders.includes(ownerId)){ state.winners=[ownerId]; state.phase='finished'; }
  }
}

function tick(ctx:any) {
  const state=ctx.state as GameState, now=ctx.now(); if(state.phase!=='playing'&&state.phase!=='overtime') return;
  state.tick++;
  state.flames=state.flames.filter(f=>f.expiresAt>now);
  state.bombs.filter(b=>b.explodeAt<=now).forEach(b=>explode(state,b.id,now));
  for(const bomb of [...state.bombs]){
    if((!bomb.motion.dx&&!bomb.motion.dy)||now<bomb.nextMoveAt)continue;
    const nx=bomb.x+bomb.motion.dx,ny=bomb.y+bomb.motion.dy;
    if(canBombMoveTo(state,bomb,nx,ny)){bomb.x=nx;bomb.y=ny;bomb.nextMoveAt=now+KICKED_BOMB_STEP_MS;}else{bomb.motion={dx:0,dy:0};bomb.nextMoveAt=0;}
    if(state.flames.some(flame=>flame.cells.some(cell=>cell.x===bomb.x&&cell.y===bomb.y)))explode(state,bomb.id,now);
  }
  for(const player of Object.values(state.players).filter(p=>!p.waiting)){
    if(!player.alive&&player.respawnAt<=now){const spawn=playerSpawn(state,player);player.x=spawn.x;player.y=spawn.y;player.alive=true;player.invulnerableUntil=now+INVULNERABLE_MS;player.nextMoveAt=now+100;}
    if(!player.alive) continue;
    if(player.bot){
      const interval=player.difficulty==='hard'?4:player.difficulty==='normal'?8:14;
      if(state.tick%interval===0) player.input=chooseBotDirection(state,player);
      const adjacentBrick=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>getMap(state.mapId).rows[player.y+dy]?.[player.x+dx]==='+'&&!state.destroyed.includes(cellKey(player.x+dx,player.y+dy)));
      if(adjacentBrick&&state.tick%(player.difficulty==='hard'?16:28)===0) placeBomb(state,player,now);
    }
    const moveDelay=moveDelayFor(player);
    if(now>=player.nextMoveAt&&(player.input.dx||player.input.dy)){
      const nx=player.x+player.input.dx, ny=player.y+player.input.dy;
      if(canMove(state,player,nx,ny)){player.x=nx;player.y=ny;player.nextMoveAt=now+moveDelay;}
      else if(player.kick){const bomb=state.bombs.find(b=>b.x===nx&&b.y===ny);const bx=nx+player.input.dx,by=ny+player.input.dy;if(bomb&&canBombMoveTo(state,bomb,bx,by)){bomb.x=bx;bomb.y=by;bomb.motion={...player.input};bomb.nextMoveAt=now+KICKED_BOMB_STEP_MS;player.x=nx;player.y=ny;player.nextMoveAt=now+moveDelay;}}
    }
    const item=state.powerups.find(i=>i.x===player.x&&i.y===player.y);if(item){applyPowerup(player,item.type);state.powerups=state.powerups.filter(i=>i.id!==item.id);}
    for(const flame of state.flames) if(flame.cells.some(c=>c.x===player.x&&c.y===player.y)) eliminate(state,player,flame.ownerId,now);
  }
  if(state.phase==='playing'&&now>=state.endsAt){const top=leaders(state);if(top.length===1){state.winners=top;state.phase='finished';}else{state.phase='overtime';state.overtimeLeaders=top;state.overtimeEndsAt=now+OVERTIME_MS;}}
  if(state.phase==='overtime'&&now>=state.overtimeEndsAt){state.winners=leaders(state);state.phase='finished';}
  if(state.phase==='playing'||state.phase==='overtime') ctx.setTimer('game-tick',TICK_MS,()=>tick(ctx));
}

export default defineRoom({
  meta:{name:'爆破派对',minPlayers:1,maxPlayers:4},
  initialState():GameState{return{schema:'bomberman-v1',phase:'lobby',hostId:null,mapId:MAPS[0].id,players:{},bombs:[],flames:[],powerups:[],destroyed:[],startedAt:0,endsAt:0,overtimeEndsAt:0,overtimeLeaders:[],winners:[],tick:0};},
  onJoin(ctx:any,player:any){const state=ctx.state as GameState;if(!state.hostId)state.hostId=ctx.host.id;const color=Object.keys(state.players).length%4;state.players[player.id]=freshPlayer(player.id,player.name,color,false);if(state.phase!=='lobby')state.players[player.id].waiting=true;},
  onReconnect(ctx:any,player:any){if(ctx.state.players[player.id])ctx.state.players[player.id].connected=true;},
  onLeave(ctx:any,player:any){const state=ctx.state as GameState;const p=state.players[player.id];if(!p)return;p.connected=false;p.ready=false;if(state.phase==='lobby')delete state.players[player.id];if(player.id===state.hostId){ctx.clearTimer('game-tick');state.phase='lobby';state.hostId=ctx.host?.id??null;}},
  actions:{
    'lobby:set-ready'(ctx:any,{player,payload}:any){const p=ctx.state.players[player.id];if(ctx.state.phase==='lobby'&&p&&!p.bot)p.ready=payload?.ready===true;},
    'lobby:set-map'(ctx:any,{player,payload}:any){if(ctx.state.phase==='lobby'&&player.id===ctx.state.hostId&&MAPS.some(m=>m.id===payload?.mapId))ctx.state.mapId=payload.mapId;},
    'lobby:add-bot'(ctx:any,{player,payload}:any){const state=ctx.state as GameState;if(state.phase!=='lobby'||player.id!==state.hostId||Object.keys(state.players).length>=4)return;const difficulty:Difficulty=['easy','normal','hard'].includes(payload?.difficulty)?payload.difficulty:'normal';const index=Object.values(state.players).filter(p=>p.bot).length;const id=`bot-${++sequence}`;state.players[id]=freshPlayer(id,BOT_NAMES[index%BOT_NAMES.length],Object.keys(state.players).length%4,true,difficulty);},
    'lobby:remove-bot'(ctx:any,{player,payload}:any){if(ctx.state.phase==='lobby'&&player.id===ctx.state.hostId&&ctx.state.players[payload?.botId]?.bot)delete ctx.state.players[payload.botId];},
    'lobby:set-bot-difficulty'(ctx:any,{player,payload}:any){const bot=ctx.state.players[payload?.botId];if(ctx.state.phase==='lobby'&&player.id===ctx.state.hostId&&bot?.bot&&['easy','normal','hard'].includes(payload?.difficulty))bot.difficulty=payload.difficulty;},
    'game:start'(ctx:any,{player}:any){const state=ctx.state as GameState;const humans=Object.values(state.players).filter(p=>!p.bot);if(state.phase!=='lobby'||player.id!==state.hostId||Object.keys(state.players).length<2||humans.some(p=>!p.ready))return;resetRound(state,ctx.now());state.phase='playing';ctx.setTimer('game-tick',TICK_MS,()=>tick(ctx));},
    'player:move'(ctx:any,{player,payload}:any){const p=ctx.state.players[player.id];if(!p||p.bot||p.waiting)return;const dx=Number(payload?.dx),dy=Number(payload?.dy);if(![-1,0,1].includes(dx)||![-1,0,1].includes(dy)||Math.abs(dx)+Math.abs(dy)>1)return;p.input={dx,dy};},
    'player:place-bomb'(ctx:any,{player}:any){if(ctx.state.phase==='playing'||ctx.state.phase==='overtime')placeBomb(ctx.state,ctx.state.players[player.id],ctx.now());},
    'player:detonate'(ctx:any,{player}:any){const state=ctx.state as GameState;if(!state.players[player.id]?.remote)return;state.bombs.filter(b=>b.ownerId===player.id&&b.remote).forEach(b=>explode(state,b.id,ctx.now()));},
    'game:return-to-lobby'(ctx:any,{player}:any){const state=ctx.state as GameState;if(player.id!==state.hostId||state.phase!=='finished')return;ctx.clearTimer('game-tick');state.phase='lobby';state.bombs=[];state.flames=[];state.powerups=[];state.destroyed=[];state.winners=[];for(const p of Object.values(state.players)){p.ready=p.bot;p.waiting=false;p.score=0;}},
  },
});
