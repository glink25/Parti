import { defineRoom, type RoomContext } from '@parti/worker-sdk';
import { WORLD_WIDTH, type BossAttack, type BossKind, type GameState, type PublicPlayer } from '../game/types';
import { findEnemy, gateY, generateChunk } from '../game/world';

const RESPAWN_MS = 4000;
const RESPAWN_INVULNERABLE_MS = 2200;
const SHOT_COOLDOWN_MS = 240;
const SHOT_LIFETIME_MS = 2500;
let lastShot: Record<string, number> = {};
type AuthorizedShot = { playerId: string; createdAt: number; expiresAt: number; projectiles: number; settled: Set<number>; power: boolean };
let authorizedShots = new Map<string, AuthorizedShot>();

export default defineRoom<GameState>({
  meta: { name: '云端远征', minPlayers: 1, maxPlayers: 4 },

  initialState() { return initialState(); },

  onRestore(ctx) {
    lastShot = {};
    authorizedShots = new Map();
    ctx.state.hostId = ctx.host.id;
    for (const player of Object.values(ctx.state.players)) {
      if (!player.alive && player.respawnAt) scheduleRespawn(ctx, player.id, Math.max(100, player.respawnAt - ctx.now()));
    }
    if (ctx.state.phase === 'boss' && ctx.state.boss) { normalizeBoss(ctx.state); scheduleBossTick(ctx, 200); }
    ctx.state.message = ctx.state.phase === 'lobby' ? '房间已恢复，请重新准备' : '远征已恢复';
  },

  onJoin(ctx, player) {
    ctx.state.hostId = ctx.host.id;
    if (ctx.state.phase !== 'lobby' && !ctx.state.players[player.id]) {
      ctx.kick(player.id, '远征已经开始，不能中途加入');
      return;
    }
    const existing = ctx.state.players[player.id];
    if (existing) { existing.connected = true; existing.name = player.name; return; }
    ctx.state.players[player.id] = createPlayer(player.id, player.name);
    ctx.state.message = '所有人准备后开始远征';
  },

  onReconnect(ctx, player) {
    const current = ctx.state.players[player.id];
    if (current) { current.connected = true; current.name = player.name; }
  },

  onLeave(ctx, player) {
    const current = ctx.state.players[player.id];
    if (!current) return;
    if (ctx.state.phase === 'lobby') delete ctx.state.players[player.id];
    else {
      current.connected = false;
      current.direction = 0;
      ctx.state.message = `${current.name} 已离线，本次远征等待其回归`;
      updateVoid(ctx.state);
      checkWipe(ctx);
    }
  },

  actions: {
    setReady(ctx, { player, payload }) {
      if (ctx.state.phase !== 'lobby') return;
      const current = ctx.state.players[player.id];
      if (!current) return;
      current.ready = Boolean(payload?.ready);
      const players = Object.values(ctx.state.players);
      if (players.length > 0 && players.every((item) => item.ready && item.connected)) startRun(ctx);
    },

    restart(ctx, { player }) {
      if (ctx.state.phase !== 'gameover' || player.id !== ctx.host.id) return;
      resetToLobby(ctx.state);
    },

    move(ctx, { player, payload }) {
      if (!isPlaying(ctx.state)) return;
      const current = activePlayer(ctx.state, player.id);
      const direction = Number(payload?.direction);
      if (!current || !Number.isFinite(direction) || direction < -1 || direction > 1) return;
      current.direction = Math.round(direction * 100) / 100;
    },

    telemetry(ctx, { player, payload }) {
      if (!isPlaying(ctx.state)) return;
      const current = activePlayer(ctx.state, player.id);
      if (!current || !current.alive) return;
      const x = Number(payload?.x); const y = Number(payload?.y); const vy = Number(payload?.vy); const cameraBottom = Number(payload?.cameraBottom);
      if (![x, y, vy, cameraBottom].every(Number.isFinite)) return;
      current.x = ((x % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH;
      // Preserve positions below world zero until the void check below runs.
      // Clamping to zero here made the initial void line (also zero)
      // impossible to cross from the authoritative worker's perspective.
      current.y = y;
      current.vy = Math.max(-1200, Math.min(1200, vy));
      current.cameraBottom = Math.max(current.cameraBottom, Math.min(cameraBottom, current.y - 180));
      ctx.state.highestY = Math.max(ctx.state.highestY, current.y);
      updateVoid(ctx.state);
      if (current.y < ctx.state.teamVoidY - 60) { killPlayer(ctx, current.id, '坠入虚空'); return; }
      if (current.y >= gateY(ctx.state.nextGate)) current.arrivedGate = ctx.state.nextGate;
      tryStartBoss(ctx);
    },

    shoot(ctx, { player, payload }) {
      if (!isPlaying(ctx.state)) return;
      const current = activePlayer(ctx.state, player.id);
      if (!current || !current.alive) return;
      const now = ctx.now();
      pruneShots(now);
      const shotId = typeof payload?.shotId === 'string' ? payload.shotId.slice(0, 96) : '';
      const originX = Number(payload?.x);
      const originY = Number(payload?.y);
      if (!shotId || authorizedShots.has(shotId) || !Number.isFinite(originX) || !Number.isFinite(originY)) return;
      const rapid = current.buffs.includes('rapid');
      if (now - (lastShot[player.id] ?? 0) < (rapid ? 110 : SHOT_COOLDOWN_MS)) return;
      lastShot[player.id] = now;
      current.shots += 1;
      const spread = current.buffs.includes('spread');
      const power = current.buffs.includes('power');
      authorizedShots.set(shotId, { playerId: current.id, createdAt: now, expiresAt: now + SHOT_LIFETIME_MS, projectiles: spread ? 3 : 1, settled: new Set(), power });
      ctx.broadcast('skyward:shot', {
        shotId,
        playerId: current.id,
        x: ((originX % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH,
        y: originY,
        spread,
        power,
      });
    },

    resolveHit(ctx, { player, payload }) {
      if (!isPlaying(ctx.state)) return;
      const shotId = typeof payload?.shotId === 'string' ? payload.shotId : '';
      const projectileIndex = Number(payload?.projectileIndex);
      const targetId = typeof payload?.targetId === 'string' ? payload.targetId : '';
      const now = ctx.now();
      pruneShots(now);
      const shot = authorizedShots.get(shotId);
      if (!shot || shot.playerId !== player.id || shot.expiresAt < now || !Number.isInteger(projectileIndex) || projectileIndex < 0 || projectileIndex >= shot.projectiles || shot.settled.has(projectileIndex) || !targetId) return;
      shot.settled.add(projectileIndex);
      const current = activePlayer(ctx.state, player.id);
      if (!current?.alive) return;
      if (targetId.startsWith('boss:')) {
        const gate = Number(targetId.slice(5));
        if (ctx.state.phase !== 'boss' || !ctx.state.boss || ctx.state.boss.gate !== gate || current.arrivedGate !== gate || ctx.now() < ctx.state.boss.vulnerableFrom) return;
        const damage = shot.power ? 2 : 1;
        ctx.state.boss.hp = Math.max(0, ctx.state.boss.hp - damage);
        ctx.broadcast('skyward:hit', { playerId: current.id, boss: true, damage });
        if (ctx.state.boss.hp === 0) defeatBoss(ctx);
        return;
      }
      defeatEnemy(ctx, current, targetId);
    },

    stomp(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id);
      if (!current?.alive || typeof payload?.enemyId !== 'string') return;
      defeatEnemy(ctx, current, payload.enemyId);
    },

    claimPickup(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id);
      const pickupId = typeof payload?.pickupId === 'string' ? payload.pickupId : '';
      if (!current?.alive || !pickupId || ctx.state.claimedPickups.includes(pickupId)) return;
      const chunkIndex = Number(pickupId.split(':')[0]);
      const pickup = Number.isInteger(chunkIndex) ? generateChunk(ctx.state.seed, chunkIndex, ctx.state.startedPlayers.length).pickups.find((item) => item.id === pickupId) : null;
      if (!pickup) return;
      ctx.state.claimedPickups.push(pickupId);
      if (pickup.kind === 'team-shield') {
        if (!ctx.state.teamBuffs.includes('team-shield')) ctx.state.teamBuffs.push('team-shield');
      } else if (!current.buffs.includes(pickup.kind)) current.buffs.push(pickup.kind);
      ctx.broadcast('skyward:pickup', { playerId: current.id, kind: pickup.kind });
    },

    activateRelay(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id);
      const chunkIndex = Number(payload?.chunkIndex);
      if (!current?.alive || !Number.isInteger(chunkIndex) || Math.abs(current.y - chunkIndex * 1600) > 1600) return;
      const relayId = `relay:${chunkIndex}`;
      if (!ctx.state.activeRelays.includes(relayId)) ctx.state.activeRelays.push(relayId);
      ctx.setTimer(relayId, ctx.state.startedPlayers.length === 1 ? 12000 : 8000, () => {
        ctx.state.activeRelays = ctx.state.activeRelays.filter((id) => id !== relayId);
      });
    },

    reportDeath(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id);
      const reason = payload?.reason === 'void' ? 'void' : payload?.reason === 'enemy' ? 'enemy' : null;
      if (!reason) return;
      if (!current?.alive || current.invulnerableUntil > ctx.now()) return;
      if (reason === 'enemy') {
        const shield = ctx.state.teamBuffs.indexOf('team-shield');
        if (shield >= 0) { ctx.state.teamBuffs.splice(shield, 1); ctx.send(player.id, 'skyward:shield', {}); return; }
      }
      killPlayer(ctx, current.id, reason === 'void' ? '坠入虚空' : '被怪物击倒');
    },

    reportBossDamage(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id);
      const boss = ctx.state.boss;
      if (!current?.alive || !boss || ctx.state.phase !== 'boss' || current.invulnerableUntil > ctx.now()) return;
      const attackId = typeof payload?.attackId === 'string' ? payload.attackId : '';
      const validAttack = boss.attacks.some((attack) => attack.id === attackId && bossAttackHits(attack, current, boss.x, boss.y, ctx.now()));
      const contact = attackId === `boss-contact:${boss.gate}` && Math.abs(current.x - boss.x) < 145 && Math.abs(current.y - boss.y) < 145;
      if (!validAttack && !contact) return;
      current.invulnerableUntil = ctx.now() + 1200;
      const shield = ctx.state.teamBuffs.indexOf('team-shield');
      if (shield >= 0) { ctx.state.teamBuffs.splice(shield, 1); ctx.send(player.id, 'skyward:shield', {}); return; }
      killPlayer(ctx, current.id, '被Boss击倒');
    },

    enableTilt(ctx, { player, payload }) {
      const current = ctx.state.players[player.id];
      if (current) current.tilt = Boolean(payload?.enabled);
    },
  },
});

function initialState(): GameState {
  return { phase: 'lobby', hostId: null, seed: 0, startedPlayers: [], players: {}, teamVoidY: 0, highestY: 0, bossCount: 0, nextGate: 1, boss: null, defeatedEnemies: [], claimedPickups: [], teamBuffs: [], activeRelays: [], bestRun: { height: 0, bosses: 0 }, message: '所有人准备后开始远征', startedAt: null };
}

function createPlayer(id: string, name: string): PublicPlayer {
  return { id, name, ready: false, connected: true, alive: true, respawnAt: null, invulnerableUntil: 0, x: WORLD_WIDTH / 2, y: 150, vy: 0, positionEpoch: 0, cameraBottom: 0, direction: 0, arrivedGate: null, kills: 0, deaths: 0, shots: 0, tilt: false, buffs: [] };
}

function startRun(ctx: RoomContext<GameState>) {
  const state = ctx.state;
  state.seed = Math.floor(ctx.random() * 0xffffffff) >>> 0;
  state.startedPlayers = Object.keys(state.players);
  state.phase = 'running'; state.startedAt = ctx.now(); state.message = '向上！在Boss门前集合';
  state.teamVoidY = 0; state.highestY = 0; state.bossCount = 0; state.nextGate = 1; state.boss = null;
  state.defeatedEnemies = []; state.claimedPickups = []; state.teamBuffs = []; state.activeRelays = [];
  for (const player of Object.values(state.players)) {
    const positionEpoch = player.positionEpoch + 1;
    Object.assign(player, createPlayer(player.id, player.name), { ready: false, positionEpoch });
  }
  ctx.broadcast('skyward:start', {});
}

function activePlayer(state: GameState, id: string) { return state.startedPlayers.includes(id) ? state.players[id] : undefined; }
function isPlaying(state: GameState) { return state.phase === 'running' || state.phase === 'boss'; }

function updateVoid(state: GameState) {
  const alive = state.startedPlayers.map((id) => state.players[id]).filter((player) => player?.connected && player.alive);
  if (alive.length) state.teamVoidY = Math.max(state.teamVoidY, Math.min(...alive.map((player) => player.cameraBottom)));
}

function killPlayer(ctx: RoomContext<GameState>, id: string, reason: string) {
  const player = ctx.state.players[id];
  if (!player?.alive || !isPlaying(ctx.state)) return;
  player.alive = false; player.deaths += 1; player.direction = 0; player.vy = 0; player.respawnAt = ctx.now() + RESPAWN_MS;
  ctx.broadcast('skyward:death', { playerId: id, reason });
  if (checkWipe(ctx)) return;
  scheduleRespawn(ctx, id, RESPAWN_MS);
}

function checkWipe(ctx: RoomContext<GameState>) {
  if (!isPlaying(ctx.state)) return false;
  const survivor = ctx.state.startedPlayers.some((id) => { const p = ctx.state.players[id]; return p?.connected && p.alive; });
  if (survivor) return false;
  if (ctx.state.highestY > ctx.state.bestRun.height) {
    ctx.state.bestRun = { height: ctx.state.highestY, bosses: ctx.state.bossCount };
  }
  ctx.state.phase = 'gameover'; ctx.state.message = '远征结束：队伍火种熄灭'; ctx.state.boss = null;
  for (const id of ctx.state.startedPlayers) ctx.clearTimer(`respawn:${id}`);
  ctx.broadcast('skyward:gameover', { height: ctx.state.highestY, bosses: ctx.state.bossCount });
  return true;
}

function resetToLobby(state: GameState) {
  for (const [id, player] of Object.entries(state.players)) {
    if (!player.connected) { delete state.players[id]; continue; }
    const positionEpoch = player.positionEpoch;
    Object.assign(player, createPlayer(player.id, player.name), { positionEpoch });
  }
  state.phase = 'lobby';
  state.seed = 0;
  state.startedPlayers = [];
  state.teamVoidY = 0;
  state.highestY = 0;
  state.bossCount = 0;
  state.nextGate = 1;
  state.boss = null;
  state.defeatedEnemies = [];
  state.claimedPickups = [];
  state.teamBuffs = [];
  state.activeRelays = [];
  state.startedAt = null;
  state.message = '所有人准备后开始远征';
}

function scheduleRespawn(ctx: RoomContext<GameState>, id: string, delay: number) {
  ctx.setTimer(`respawn:${id}`, delay, () => {
    const player = ctx.state.players[id];
    if (!player || player.alive || ctx.state.phase === 'gameover') return;
    player.alive = true; player.respawnAt = null; player.vy = 760;
    player.invulnerableUntil = ctx.now() + RESPAWN_INVULNERABLE_MS;
    const atGate = player.arrivedGate === ctx.state.nextGate;
    player.y = atGate ? gateY(ctx.state.nextGate) + 80 : Math.max(ctx.state.teamVoidY + 180, player.cameraBottom + 180);
    player.x = WORLD_WIDTH / 2;
    player.positionEpoch += 1;
    tryStartBoss(ctx);
  });
}

function defeatEnemy(ctx: RoomContext<GameState>, player: PublicPlayer, enemyId: string) {
  if (ctx.state.defeatedEnemies.includes(enemyId)) return;
  const enemy = findEnemy(ctx.state.seed, ctx.state.startedPlayers.length, enemyId);
  if (!enemy) return;
  ctx.state.defeatedEnemies.push(enemyId); player.kills += 1;
  ctx.broadcast('skyward:hit', { playerId: player.id, enemyId });
}

function pruneShots(now: number) {
  for (const [id, shot] of authorizedShots) if (shot.expiresAt < now) authorizedShots.delete(id);
}

function tryStartBoss(ctx: RoomContext<GameState>) {
  if (ctx.state.phase !== 'running') return;
  const ready = ctx.state.startedPlayers.every((id) => { const p = ctx.state.players[id]; return p?.connected && p.alive && p.arrivedGate === ctx.state.nextGate; });
  if (!ready) return;
  const gate = ctx.state.nextGate; const tier = Math.floor((gate - 1) / 3) + 1;
  const kinds: BossKind[] = ['storm-eye', 'sky-whale', 'thunder-core']; const id = kinds[(gate - 1) % kinds.length]!;
  const names: Record<BossKind, string> = { 'storm-eye': '风暴之眼', 'sky-whale': '巡天鲸', 'thunder-core': '雷云核心' };
  const maxHp = 28 + (gate - 1) * 8 + ctx.state.startedPlayers.length * 14;
  const now = ctx.now();
  ctx.state.phase = 'boss';
  ctx.state.boss = { gate, id, name: names[id], tier, hp: maxHp, maxHp, x: WORLD_WIDTH / 2, y: gateY(gate) + 270, phase: 1, attackSequence: 0, attacks: [], nextAttackAt: now + 1500, vulnerableFrom: now + 700 };
  ctx.state.message = `${ctx.state.boss.name} 出现了！集中射击`;
  ctx.broadcast('skyward:boss', { gate, name: ctx.state.boss.name });
  scheduleBossTick(ctx, 200);
}

function defeatBoss(ctx: RoomContext<GameState>) {
  const boss = ctx.state.boss; if (!boss) return;
  ctx.state.bossCount += 1; ctx.state.nextGate += 1; ctx.state.phase = 'running'; ctx.state.boss = null;
  ctx.clearTimer('boss:tick');
  ctx.state.teamVoidY = Math.max(ctx.state.teamVoidY, gateY(boss.gate));
  for (const id of ctx.state.startedPlayers) ctx.state.players[id].arrivedGate = null;
  ctx.state.message = 'Boss已击败，新的天空正在展开';
  ctx.broadcast('skyward:boss-defeated', { count: ctx.state.bossCount });
}

function scheduleBossTick(ctx: RoomContext<GameState>, delay = 250) {
  ctx.setTimer('boss:tick', delay, () => {
    const boss = ctx.state.boss; if (!boss || ctx.state.phase !== 'boss') return;
    const now = ctx.now();
    boss.attacks = boss.attacks.filter((attack) => attack.endsAt + 500 > now);
    boss.x = WORLD_WIDTH / 2 + Math.sin(now / (4200 / Math.min(2, boss.tier * .15 + 1))) * (boss.id === 'sky-whale' ? 245 : 310);
    boss.phase = boss.hp <= boss.maxHp * .35 ? 3 : boss.hp <= boss.maxHp * .7 ? 2 : 1;
    if (now >= boss.nextAttackAt) {
      const targets = ctx.state.startedPlayers.map((id) => ctx.state.players[id]).filter((p) => p?.connected && p.alive);
      const target = targets[boss.attackSequence % Math.max(1, targets.length)];
      const sequence = boss.attackSequence++;
      const kind = attackKind(boss.id, boss.phase, sequence);
      const warning = kind === 'lightning' ? 1100 : kind === 'dive' ? 800 : 550;
      const duration = kind === 'trail' ? 2400 : warning + 700;
      const attack: BossAttack = { id: `boss:${boss.gate}:${sequence}`, kind, startedAt: now, endsAt: now + duration, targetX: target?.x ?? WORLD_WIDTH / 2, targetY: target?.y ?? gateY(boss.gate) + 80 };
      boss.attacks.push(attack);
      boss.nextAttackAt = now + Math.max(850, 2400 - boss.tier * 130 - boss.phase * 170);
      ctx.broadcast('skyward:boss-attack', attack);
    }
    scheduleBossTick(ctx);
  });
}

function attackKind(id: BossKind, phase: number, sequence: number): BossAttack['kind'] {
  if (id === 'storm-eye') return phase >= 2 && sequence % 3 === 2 ? 'fan' : 'aimed';
  if (id === 'sky-whale') return phase >= 2 && sequence % 2 ? 'trail' : 'dive';
  return phase >= 3 && sequence % 3 === 2 ? 'summon' : 'lightning';
}

function bossAttackHits(attack: BossAttack, player: PublicPlayer, bossX: number, bossY: number, now: number) {
  if (attack.startedAt > now || attack.endsAt + 250 < now) return false;
  const progress = Math.max(0, Math.min(1, (now - attack.startedAt) / Math.max(1, attack.endsAt - attack.startedAt)));
  let x = bossX; let y = bossY; let radius = 55;
  if (attack.kind === 'lightning') { if (progress < .5) return false; x = attack.targetX; y = attack.targetY; radius = 110; }
  else if (attack.kind === 'trail') { x = attack.targetX; y = attack.targetY; radius = 140; }
  else { x += (attack.targetX - x) * progress; y += (attack.targetY - y) * progress; radius = attack.kind === 'dive' ? 130 : attack.kind === 'fan' || attack.kind === 'summon' ? 125 : 70; }
  return Math.abs(player.x - x) < radius && Math.abs(player.y - y) < radius;
}

function normalizeBoss(state: GameState) {
  const boss = state.boss; if (!boss) return;
  const now = Date.now(); const legacy = boss as Partial<NonNullable<GameState['boss']>>;
  boss.tier ??= Math.floor((boss.gate - 1) / 3) + 1;
  boss.x ??= WORLD_WIDTH / 2; boss.y ??= gateY(boss.gate) + 270; boss.phase ??= 1;
  boss.attackSequence ??= 0; boss.attacks ??= []; boss.nextAttackAt ??= now + 1000; boss.vulnerableFrom ??= now;
  if (!['storm-eye', 'sky-whale', 'thunder-core'].includes(legacy.id ?? '')) boss.id = 'storm-eye';
}
