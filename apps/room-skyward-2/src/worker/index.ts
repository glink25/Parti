import { defineRoom, type RoomContext } from '@parti/worker-sdk';
import { CHUNK_HEIGHT, WORLD_WIDTH, type BossAttack, type GameState, type PickupKind, type PublicPlayer } from '../game/contracts';
import { activeBossAfterRestore, bossDefeatedKey, canStartBoss } from '../game/boss';
import { findEntity, generateChunk } from '../game/generation';

const RESPAWN_MS = 4000;
const INVULNERABLE_MS = 2200;
type LatestPose = { sequence: number; x: number; y: number; vy: number; cameraBottom: number; direction: number; persistedAt: number };
let latestPoses = new Map<string, LatestPose>();

export default defineRoom<GameState>({
  meta: { name: '云端远征 2', minPlayers: 1, maxPlayers: 4 },
  initialState,
  onRestore(ctx) {
    latestPoses = new Map(); ctx.state.hostId = ctx.host.id;
    ctx.state.boss = activeBossAfterRestore(ctx.state);
    for (const player of Object.values(ctx.state.players)) { player.lastHitSequence ??= 0; player.lastOutcomeSequence ??= 0; latestPoses.set(player.id, { sequence: -1, x: player.x, y: player.y, vy: player.vy, cameraBottom: player.cameraBottom, direction: player.direction, persistedAt: ctx.now() }); }
    for (const player of Object.values(ctx.state.players)) if (!player.alive && player.respawnAt) scheduleRespawn(ctx, player.id, Math.max(100, player.respawnAt - ctx.now()));
    if (ctx.state.boss) scheduleBossTick(ctx, 200);
  },
  onJoin(ctx, player) {
    ctx.state.hostId = ctx.host.id;
    if (ctx.state.phase !== 'lobby' && !ctx.state.players[player.id]) { ctx.kick(player.id, '远征已经开始'); return; }
    const current = ctx.state.players[player.id];
    if (current) { current.connected = true; current.name = player.name; }
    else ctx.state.players[player.id] = createPlayer(player.id, player.name);
  },
  onReconnect(ctx, player) { const current = ctx.state.players[player.id]; if (current) { current.connected = true; current.name = player.name; current.lastHitSequence ??= 0; current.lastOutcomeSequence ??= 0; latestPoses.set(player.id, { sequence: -1, x: current.x, y: current.y, vy: current.vy, cameraBottom: current.cameraBottom, direction: current.direction, persistedAt: ctx.now() }); } },
  onLeave(ctx, player) {
    const current = ctx.state.players[player.id]; if (!current) return;
    if (ctx.state.phase === 'lobby') delete ctx.state.players[player.id];
    else { current.connected = false; current.direction = 0; updateVoid(ctx.state); checkWipe(ctx); }
  },
  actions: {
    setReady(ctx, { player, payload }) {
      if (ctx.state.phase !== 'lobby') return; const current = ctx.state.players[player.id]; if (!current) return;
      current.ready = Boolean(payload?.ready); const all = Object.values(ctx.state.players);
      if (all.length && all.every((p) => p.ready && p.connected)) startRun(ctx);
    },
    restart(ctx, { player }) { if (ctx.state.phase === 'gameover' && player.id === ctx.host.id) resetLobby(ctx.state); },
    publishPose(ctx, { player, payload }) {
      if (ctx.state.phase !== 'running') return; const current = activePlayer(ctx.state, player.id); if (!current?.alive) return;
      const sequence = Number(payload?.sequence), x = Number(payload?.x), y = Number(payload?.y), vy = Number(payload?.vy), cameraBottom = Number(payload?.cameraBottom), direction = Number(payload?.direction);
      if (!Number.isInteger(sequence) || ![x, y, vy, cameraBottom, direction].every(Number.isFinite)) return;
      const previous = latestPoses.get(player.id); if (previous && sequence <= previous.sequence) return;
      const now = ctx.now(); const pose: LatestPose = { sequence, x: (x % WORLD_WIDTH + WORLD_WIDTH) % WORLD_WIDTH, y, vy, cameraBottom, direction, persistedAt: previous?.persistedAt ?? 0 }; latestPoses.set(player.id, pose);
      ctx.broadcast('skyward2:pose', { playerId: player.id, sequence, x: pose.x, y, vy, direction, sentAt: now });
      if (now - pose.persistedAt >= 500) persistPose(ctx, current, pose, now);
    },
    shoot(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id); if (!current?.alive) return;
      const id = typeof payload?.shotId === 'string' ? payload.shotId.slice(0, 96) : ''; const x = Number(payload?.x), y = Number(payload?.y); if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return;
      ctx.broadcast('skyward2:shot', { shotId: id, playerId: player.id, x, y, power: Boolean(payload?.power) });
    },
    hitEnemy(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id); const sequence = Number(payload?.sequence); const eventId = typeof payload?.eventId === 'string' ? payload.eventId : ''; const shotId = typeof payload?.shotId === 'string' ? payload.shotId : ''; const enemyId = typeof payload?.enemyId === 'string' ? payload.enemyId : ''; const damage = Number(payload?.damage);
      if (!current?.alive || !eventId || !shotId || !Number.isInteger(sequence) || sequence <= current.lastHitSequence || !Number.isFinite(damage)) return;
      current.lastHitSequence = sequence; damageEnemy(ctx, player.id, enemyId, Math.max(1, Math.min(2, Math.round(damage))));
    },
    stompEnemy(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id); const sequence = Number(payload?.sequence); const eventId = typeof payload?.eventId === 'string' ? payload.eventId : '';
      if (!current?.alive || !eventId || !Number.isInteger(sequence) || sequence <= current.lastHitSequence || typeof payload?.enemyId !== 'string') return;
      current.lastHitSequence = sequence; damageEnemy(ctx, player.id, payload.enemyId, 1);
    },
    landPlatform(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id); const id = typeof payload?.platformId === 'string' ? payload.platformId : ''; if (!current?.alive || !id) return;
      const entity = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, id); if (!entity || !('kind' in entity) || !id.includes(':')) return;
      const platform = entity as ReturnType<typeof generateChunk>['platforms'][number]; const now = ctx.now();
      if (platform.kind === 'fragile') ctx.state.entities[id] = { disabledUntil: Number.MAX_SAFE_INTEGER };
      if (platform.kind === 'recovering') ctx.state.entities[id] = { disabledUntil: now + (platform.recoverMs ?? 3200) };
      if (platform.kind === 'trigger' && platform.linkedId) ctx.state.entities[platform.linkedId] = { activatedUntil: now + 8000 };
    },
    claimPickup(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id); const id = typeof payload?.pickupId === 'string' ? payload.pickupId : ''; if (!current?.alive || !id || ctx.state.claimedPickups.includes(id)) return;
      const entity = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, id); if (!entity || !('durationMs' in entity)) return;
      ctx.state.claimedPickups.push(id); const pickup = entity as { kind: PickupKind; durationMs: number };
      current.buffs[pickup.kind] = pickup.kind === 'shield' ? Number.MAX_SAFE_INTEGER : ctx.now() + pickup.durationMs;
      ctx.broadcast('skyward2:pickup', { playerId: player.id, kind: pickup.kind });
    },
    playerOutcome(ctx, { player, payload }) {
      const current = activePlayer(ctx.state, player.id); const sequence = Number(payload?.sequence); const eventId = typeof payload?.eventId === 'string' ? payload.eventId : ''; const outcome = payload?.outcome;
      if (!current?.alive || !eventId || !Number.isInteger(sequence) || sequence <= current.lastOutcomeSequence || (outcome !== 'shield' && outcome !== 'death')) return;
      current.lastOutcomeSequence = sequence; const reason = typeof payload?.reason === 'string' ? payload.reason.slice(0, 40) : '危险';
      if (outcome === 'shield') { delete current.buffs.shield; ctx.broadcast('skyward2:outcome', { playerId: player.id, eventId, outcome, reason }); return; }
      kill(ctx, current.id, reason);
    },
    enableTilt(ctx, { player, payload }) { const current = ctx.state.players[player.id]; if (current) current.tilt = Boolean(payload?.enabled); },
  },
});

function initialState(): GameState { return { phase: 'lobby', hostId: null, seed: 0, startedAt: null, startedPlayers: [], players: {}, teamVoidY: 0, highestY: 0, bossCount: 0, defeatedEnemies: [], claimedPickups: [], entities: {}, boss: null, bestRun: { height: 0, bosses: 0 }, message: '所有人准备后开始' }; }
function createPlayer(id: string, name: string): PublicPlayer { return { id, name, ready: false, connected: true, alive: true, respawnAt: null, invulnerableUntil: 0, x: WORLD_WIDTH / 2, y: 120, vy: 0, cameraBottom: 0, direction: 0, positionEpoch: 0, kills: 0, deaths: 0, shots: 0, tilt: false, lastHitSequence: 0, lastOutcomeSequence: 0, buffs: {} }; }
function activePlayer(state: GameState, id: string) { return state.phase === 'running' && state.startedPlayers.includes(id) ? state.players[id] : undefined; }
function startRun(ctx: RoomContext<GameState>) {
  const s = ctx.state; s.phase = 'running'; s.seed = Math.floor(ctx.random() * 0xffffffff) >>> 0; s.startedAt = ctx.now(); s.startedPlayers = Object.keys(s.players); s.teamVoidY = 0; s.highestY = 0; s.bossCount = 0; s.defeatedEnemies = []; s.claimedPickups = []; s.entities = {}; s.boss = null; s.message = '向上攀登';
  for (const p of Object.values(s.players)) { const epoch = p.positionEpoch + 1; Object.assign(p, createPlayer(p.id, p.name), { positionEpoch: epoch }); }
  ctx.broadcast('skyward2:start', {});
}
function resetLobby(s: GameState) {
  for (const [id, p] of Object.entries(s.players)) { if (!p.connected) delete s.players[id]; else { const epoch = p.positionEpoch; Object.assign(p, createPlayer(id, p.name), { positionEpoch: epoch }); } }
  Object.assign(s, { phase: 'lobby', seed: 0, startedAt: null, startedPlayers: [], teamVoidY: 0, highestY: 0, bossCount: 0, defeatedEnemies: [], claimedPickups: [], entities: {}, boss: null, message: '所有人准备后开始' });
}
function updateVoid(s: GameState) { const alive = s.startedPlayers.map((id) => s.players[id]).filter((p) => p?.connected && p.alive); if (alive.length) s.teamVoidY = Math.max(s.teamVoidY, Math.min(...alive.map((p) => p.cameraBottom))); }
function kill(ctx: RoomContext<GameState>, id: string, reason: string) { const p = ctx.state.players[id]; if (!p?.alive || ctx.state.phase !== 'running') return; p.alive = false; p.deaths += 1; p.respawnAt = ctx.now() + RESPAWN_MS; p.vy = 0; ctx.broadcast('skyward2:death', { playerId: id, reason }); if (!checkWipe(ctx)) scheduleRespawn(ctx, id, RESPAWN_MS); }
function checkWipe(ctx: RoomContext<GameState>) { if (ctx.state.startedPlayers.some((id) => ctx.state.players[id]?.connected && ctx.state.players[id].alive)) return false; ctx.state.bestRun = { height: Math.max(ctx.state.bestRun.height, ctx.state.highestY), bosses: Math.max(ctx.state.bestRun.bosses, ctx.state.bossCount) }; ctx.state.phase = 'gameover'; ctx.state.boss = null; ctx.state.message = '远征结束'; for (const id of ctx.state.startedPlayers) ctx.clearTimer(`respawn:${id}`); return true; }
function scheduleRespawn(ctx: RoomContext<GameState>, id: string, delay: number) { ctx.setTimer(`respawn:${id}`, delay, () => { const p = ctx.state.players[id]; if (!p || p.alive || ctx.state.phase !== 'running') return; p.alive = true; p.respawnAt = null; p.invulnerableUntil = ctx.now() + INVULNERABLE_MS; p.x = WORLD_WIDTH / 2; p.y = Math.max(ctx.state.teamVoidY + 180, p.cameraBottom + 180); p.vy = 760; p.positionEpoch += 1; }); }

function damageEnemy(ctx: RoomContext<GameState>, playerId: string, id: string, damage: number) {
  const p = activePlayer(ctx.state, playerId); if (!p?.alive || ctx.state.defeatedEnemies.includes(id)) return;
  const summoned = ctx.state.boss?.summons.find((enemy) => enemy.id === id);
  if (summoned) { summoned.hp -= damage; if (summoned.hp <= 0) { ctx.state.defeatedEnemies.push(id); p.kills += 1; ctx.state.boss!.summons = ctx.state.boss!.summons.filter((enemy) => enemy.id !== id); } return; }
  const entity = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, id); if (!entity || !('hp' in entity)) return;
  if (entity.boss && ctx.state.boss?.enemyId !== id) return;
  if (ctx.state.boss?.enemyId === id) { ctx.state.boss.hp = Math.max(0, ctx.state.boss.hp - damage); if (!ctx.state.boss.hp) defeatBoss(ctx); return; }
  const hp = (ctx.state.entities[id]?.hp ?? entity.hp) - damage; ctx.state.entities[id] = { hp };
  if (hp <= 0) { ctx.state.defeatedEnemies.push(id); p.kills += 1; ctx.broadcast('skyward2:enemy-defeated', { enemyId: id, playerId }); }
}
function startBoss(ctx: RoomContext<GameState>, chunkIndex: number) {
  if (!canStartBoss(ctx.state, chunkIndex)) return;
  const chunk = generateChunk(ctx.state.seed, chunkIndex, ctx.state.startedPlayers.length); const enemy = chunk.enemies.find((e) => e.boss); if (!enemy) return;
  const now = ctx.now(); ctx.state.boss = { enemyId: enemy.id, chunkIndex, hp: enemy.hp, maxHp: enemy.hp, startedAt: now, nextAttackAt: now + 3200, sequence: 0, attacks: [], summons: [] }; ctx.state.message = '风暴守卫封锁了上行通路'; scheduleBossTick(ctx, 200);
}
function scheduleBossTick(ctx: RoomContext<GameState>, delay = 200) {
  ctx.setTimer('boss:tick', delay, () => {
    const boss = ctx.state.boss; if (!boss || ctx.state.phase !== 'running') return; const now = ctx.now(); boss.attacks = boss.attacks.filter((a) => a.endsAt > now);
    if (now >= boss.nextAttackAt) {
      const players = ctx.state.startedPlayers.map((id) => ctx.state.players[id]).filter((p) => p?.connected && p.alive); const target = players[boss.sequence % Math.max(1, players.length)]; const kinds: BossAttack['kind'][] = ['lightning', 'lock-zone', 'platform-hazard', 'summon']; const kind = kinds[boss.sequence % kinds.length]!; const warning = kind === 'lightning' ? 1900 : kind === 'summon' ? 1300 : 1600;
      const x = target?.x ?? 450, y = target?.y ?? boss.chunkIndex * CHUNK_HEIGHT + 740;
      boss.attacks.push({ id: `${boss.enemyId}:attack:${boss.sequence}`, kind, x, y, startedAt: now, activeAt: now + warning, endsAt: now + warning + 700 });
      if (kind === 'summon' && boss.summons.length < 3) boss.summons.push({ id: `${boss.enemyId}:summon:${boss.sequence}`, kind: 'floater', x, y: boss.chunkIndex * CHUNK_HEIGHT + 790, hp: 2, radius: 34, movement: { range: 110, periodMs: 2800, phase: (boss.sequence % 8) / 8 } });
      boss.sequence += 1; boss.nextAttackAt = now + Math.max(3200, 4800 - boss.sequence * 25);
    }
    scheduleBossTick(ctx);
  });
}
function defeatBoss(ctx: RoomContext<GameState>) {
  const boss = ctx.state.boss; if (!boss) return; const chunkIndex = boss.chunkIndex;
  boss.attacks = []; boss.summons = []; ctx.clearTimer('boss:tick');
  if (!ctx.state.defeatedEnemies.includes(boss.enemyId)) ctx.state.defeatedEnemies.push(boss.enemyId);
  ctx.state.entities[bossDefeatedKey(chunkIndex)] = { activatedUntil: Number.MAX_SAFE_INTEGER }; ctx.state.bossCount += 1; ctx.state.boss = null; ctx.state.message = '通路恢复，继续向上';
  ctx.broadcast('skyward2:boss-defeated', { chunkIndex });
}
function persistPose(ctx: RoomContext<GameState>, player: PublicPlayer, pose: LatestPose, now: number) {
  player.x = pose.x; player.y = pose.y; player.vy = pose.vy; player.direction = pose.direction; player.cameraBottom = Math.max(player.cameraBottom, Math.min(pose.cameraBottom, pose.y - 140)); pose.persistedAt = now;
  ctx.state.highestY = Math.max(ctx.state.highestY, pose.y); updateVoid(ctx.state); pruneWorld(ctx.state, now);
  const chunk = Math.floor(pose.y / CHUNK_HEIGHT); if (pose.y >= chunk * CHUNK_HEIGHT + 620) startBoss(ctx, chunk);
}
function pruneWorld(s: GameState, now: number) { const below = Math.floor(s.teamVoidY / CHUNK_HEIGHT) - 2; for (const [id, value] of Object.entries(s.entities)) { const chunk = Number(id.split(':')[0]); if ((Number.isInteger(chunk) && chunk < below) || ((value.disabledUntil ?? Infinity) < now && (value.activatedUntil ?? 0) < now && value.hp == null)) delete s.entities[id]; } s.claimedPickups = s.claimedPickups.filter((id) => Number(id.split(':')[0]) >= below); s.defeatedEnemies = s.defeatedEnemies.filter((id) => Number(id.split(':')[0]) >= below); }
