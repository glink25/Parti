import { defineRoom,type RoomContext } from '@parti/worker-sdk';
import { ELEMENTS,SCHEMA_VERSION,WORLD_HEIGHT,WORLD_WIDTH,type Element,type EnemyState,type EnvironmentState,type GameState,type PublicPlayer,type StatusInstance } from '../game/contracts';

export default defineRoom<GameState>({
 meta:{name:'元素训练场',minPlayers:1,maxPlayers:4},initialState,
 onRestore(ctx){if(ctx.state.schemaVersion!==SCHEMA_VERSION)replace(ctx.state,initialState());ctx.state.hostId=ctx.host.id;},
 onJoin(ctx,player){ctx.state.hostId=ctx.host.id;if(ctx.state.phase!=='lobby'&&!ctx.state.players[player.id]){ctx.kick(player.id,'训练已经开始');return;}const old=ctx.state.players[player.id];if(old){old.connected=true;old.name=player.name;}else ctx.state.players[player.id]=makePlayer(player.id,player.name);},
 onReconnect(ctx,player){ctx.state.hostId=ctx.host.id;const p=ctx.state.players[player.id];if(p){p.connected=true;p.name=player.name;}},
 onLeave(ctx,player){const p=ctx.state.players[player.id];if(ctx.state.phase==='lobby')delete ctx.state.players[player.id];else if(p)p.connected=false;ctx.state.hostId=ctx.host.id;checkGameOver(ctx);},
 actions:{
  setReady(ctx,{player,payload}){if(ctx.state.phase!=='lobby')return;const p=ctx.state.players[player.id];if(!p)return;p.ready=Boolean(payload?.ready);const all=Object.values(ctx.state.players);if(all.length&&all.every(v=>v.ready&&v.connected))start(ctx);},
  restart(ctx,{player}){if(player.id!==ctx.host.id||ctx.state.phase!=='gameover')return;resetLobby(ctx.state);},
  publishPlayer(ctx,{player,payload}){if(ctx.state.phase!=='running')return;const p=ctx.state.players[player.id];if(!p)return;const sequence=Number(payload?.sequence);if(!Number.isInteger(sequence)||sequence<=p.sequence)return;p.sequence=sequence;p.x=clamp(Number(payload?.x),0,WORLD_WIDTH);p.y=clamp(Number(payload?.y),130,WORLD_HEIGHT-80);p.hp=clamp(Number(payload?.hp),0,100);p.downed=Boolean(payload?.downed)||p.hp<=0;p.elements=elements(payload?.elements);p.statuses=statuses(payload?.statuses);p.kills=Math.max(0,Math.floor(Number(payload?.kills)||0));ctx.broadcast('magicka:player',{...p});checkGameOver(ctx);},
  syncWorld(ctx,{player,payload}){if(ctx.state.phase!=='running'||player.id!==ctx.host.id)return;const sequence=Number(payload?.sequence);if(!Number.isInteger(sequence)||sequence<=ctx.state.worldSequence)return;ctx.state.worldSequence=sequence;ctx.state.enemies=Object.fromEntries(enemyList(payload?.enemies).map(e=>[e.id,e]));ctx.state.environments=Object.fromEntries(environmentList(payload?.environments).map(e=>[e.id,e]));},
  reportEnemyDamage(ctx,{player,payload}){if(ctx.state.phase!=='running')return;const eventId=text(payload?.eventId,100),enemyId=text(payload?.enemyId,100),spellId=text(payload?.spellId,100),amount=Number(payload?.amount);if(!eventId||!enemyId||!Number.isFinite(amount)||amount<=0)return;ctx.broadcast('magicka:enemy-damage',{eventId,enemyId,sourcePlayerId:player.id,spellId,amount,statuses:statuses(payload?.statuses)});},
  reportPlayerEffect(ctx,{player,payload}){if(ctx.state.phase!=='running')return;const eventId=text(payload?.eventId,100),targetPlayerId=text(payload?.targetPlayerId,100);if(!eventId||!targetPlayerId||!ctx.state.players[targetPlayerId])return;ctx.broadcast('magicka:player-effect',{eventId,sourcePlayerId:player.id,targetPlayerId,effects:Array.isArray(payload?.effects)?payload.effects:[]});},
  reportEnvironment(ctx,{player,payload}){if(ctx.state.phase!=='running')return;const environment=environmentList([payload])[0];if(environment)ctx.broadcast('magicka:environment',{...environment,sourcePlayerId:player.id});}
 }
});
function initialState():GameState{return{schemaVersion:SCHEMA_VERSION,phase:'lobby',hostId:null,startedAt:null,players:{},enemies:{},environments:{},worldSequence:0,damageEvents:[],totalKills:0,message:'所有玩家准备后开始'}}
function makePlayer(id:string,name:string):PublicPlayer{return{id,name,ready:false,connected:true,x:WORLD_WIDTH/2,y:WORLD_HEIGHT/2,hp:100,downed:false,sequence:0,elements:[],statuses:[],kills:0}}
function start(ctx:RoomContext<GameState>){ctx.state.phase='running';ctx.state.startedAt=ctx.now();ctx.state.hostId=ctx.host.id;ctx.state.enemies={};ctx.state.environments={};ctx.state.worldSequence=0;ctx.state.totalKills=0;ctx.state.message='训练开始';for(const [id,p]of Object.entries(ctx.state.players))Object.assign(p,makePlayer(id,p.name),{ready:true});ctx.broadcast('magicka:start',{});}
function resetLobby(s:GameState){for(const[id,p]of Object.entries(s.players)){if(!p.connected)delete s.players[id];else Object.assign(p,makePlayer(id,p.name));}Object.assign(s,{phase:'lobby',startedAt:null,enemies:{},environments:{},worldSequence:0,totalKills:0,message:'所有玩家准备后开始'});}
function checkGameOver(ctx:RoomContext<GameState>){if(ctx.state.phase!=='running')return;const active=Object.values(ctx.state.players).filter(p=>p.connected);if(active.length&&active.every(p=>p.downed)){ctx.state.phase='gameover';ctx.state.message='全员倒地';ctx.broadcast('magicka:gameover',{});}}
function elements(v:unknown):Element[]{return Array.isArray(v)?v.filter((x):x is Element=>ELEMENTS.includes(x as Element)).slice(0,4):[]}
function statuses(v:unknown):StatusInstance[]{return Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&typeof x.kind==='string').slice(0,16) as StatusInstance[]:[]}
function enemyList(v:unknown):EnemyState[]{return Array.isArray(v)?v.filter(x=>x&&typeof x.id==='string').slice(0,80) as EnemyState[]:[]}
function environmentList(v:unknown):EnvironmentState[]{return Array.isArray(v)?v.filter(x=>x&&typeof x.id==='string').slice(0,32) as EnvironmentState[]:[]}
function clamp(v:number,min:number,max:number){return Number.isFinite(v)?Math.max(min,Math.min(max,v)):min}function text(v:unknown,n:number){return typeof v==='string'?v.slice(0,n):''}
function replace(target:GameState,next:GameState){for(const k of Object.keys(target)as Array<keyof GameState>)delete target[k];Object.assign(target,next);}
