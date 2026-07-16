import {
  AI_SPEED, BULLET_SPEED, MATCH_DURATION_MS, MAX_AI, MAX_BULLETS, MAX_POWER_UPS,
  PLAYER_SPEED, RESPAWN_MS, TANK_SIZE,
  type AiState, type BaseState, type Direction, type GameResult, type GameState,
  type PlayerState, type Point, type PowerUpKind, type Team,
} from './contracts';
import { MAP_BY_ID, tileAt } from './maps';

const DIRECTIONS: Record<Exclude<Direction, 'none'>, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

export function initialState(): GameState {
  return {
    schema: 'tank-battle-v1', phase: 'lobby', config: { mode: 'freeForAll', mapId: 'crossfire' },
    hostId: null, players: {}, bases: {}, bullets: {}, ai: {}, powerUps: {}, destroyedTiles: [],
    startedAt: null, deadlineAt: null, lastTickAt: null, nextAiSpawnAt: 0, nextPowerUpAt: 0,
    sequence: 0, result: null,
  };
}

export function createPlayer(id: string, name: string, index: number): PlayerState {
  return {
    id, name, ready: false, team: index % 2 ? 'blue' : 'red', connected: true,
    alive: false, eliminated: false, x: 0, y: 0, direction: 'up', input: 'none',
    kills: 0, aiKills: 0, shieldUntil: 0, rapidFireUntil: 0, armor: 0,
    nextFireAt: 0, respawnAt: null,
  };
}

function nextId(state: GameState, prefix: string): string {
  state.sequence += 1;
  return `${prefix}:${state.sequence}`;
}

function teamPlayers(state: GameState, team: Team): PlayerState[] {
  return Object.values(state.players).filter((player) => player.team === team);
}

export function canStart(state: GameState): boolean {
  const players = Object.values(state.players);
  if (players.length < 2 || players.some((player) => !player.ready)) return false;
  if (state.config.mode === 'team2v2') {
    return players.length === 4 && teamPlayers(state, 'red').length === 2 && teamPlayers(state, 'blue').length === 2;
  }
  return players.length <= 4;
}

export function startMatch(state: GameState, now: number): boolean {
  const map = MAP_BY_ID.get(state.config.mapId);
  if (!map || !canStart(state)) return false;
  state.phase = 'running'; state.bases = {}; state.bullets = {}; state.ai = {}; state.powerUps = {};
  state.destroyedTiles = []; state.startedAt = now; state.deadlineAt = now + MATCH_DURATION_MS;
  state.lastTickAt = now; state.nextAiSpawnAt = now + 15000; state.nextPowerUpAt = now + 8000; state.result = null;
  const players = Object.values(state.players);
  const ffaLayout = map.ffaLayouts[players.length as 2 | 3 | 4];
  players.forEach((player, index) => {
    const spawn = state.config.mode === 'team2v2'
      ? map.teamSpawns[player.team][teamPlayers(state, player.team).findIndex((p) => p.id === player.id)]
      : ffaLayout.spawns[index];
    Object.assign(player, { ready: false, connected: true, alive: true, eliminated: false,
      x: spawn.x, y: spawn.y, direction: player.team === 'red' ? 'right' : 'left', input: 'none',
      kills: 0, aiKills: 0, shieldUntil: now + 1800, rapidFireUntil: 0, armor: 0, nextFireAt: now, respawnAt: null });
  });
  if (state.config.mode === 'team2v2') {
    for (const team of ['red', 'blue'] as const) {
      const base = map.teamBases[team];
      state.bases[`team:${team}`] = { id: `team:${team}`, team, x: base.position.x, y: base.position.y, hp: 3, maxHp: 3, fortifiedUntil: 0, protectionTiles: base.protectionTiles };
    }
  } else {
    players.forEach((player, index) => {
      const base = ffaLayout.bases[index];
      state.bases[`player:${player.id}`] = { id: `player:${player.id}`, ownerId: player.id, x: base.position.x, y: base.position.y, hp: 3, maxHp: 3, fortifiedUntil: 0, protectionTiles: base.protectionTiles };
    });
  }
  return true;
}

function baseFor(state: GameState, player: PlayerState): BaseState | undefined {
  return state.config.mode === 'team2v2' ? state.bases[`team:${player.team}`] : state.bases[`player:${player.id}`];
}

function isDestroyed(state: GameState, x: number, y: number): boolean {
  const map = MAP_BY_ID.get(state.config.mapId)!;
  return state.destroyedTiles.includes(Math.floor(y) * map.width + Math.floor(x));
}

function blocksMovement(state: GameState, x: number, y: number): boolean {
  const map = MAP_BY_ID.get(state.config.mapId)!;
  const tile = tileAt(map, x, y);
  return !isDestroyed(state, x, y) && (tile === 'brick' || tile === 'steel' || tile === 'water');
}

export function canOccupy(state: GameState, x: number, y: number, size = TANK_SIZE): boolean {
  const half = size / 2;
  return !blocksMovement(state, x - half, y - half) && !blocksMovement(state, x + half, y - half) &&
    !blocksMovement(state, x - half, y + half) && !blocksMovement(state, x + half, y + half);
}

function moveTank(state: GameState, tank: Point & { direction: Exclude<Direction, 'none'> }, direction: Direction, speed: number, dt: number): void {
  if (direction === 'none') return;
  tank.direction = direction;
  const delta = DIRECTIONS[direction];
  const nx = tank.x + delta.x * speed * dt;
  const ny = tank.y + delta.y * speed * dt;
  if (canOccupy(state, nx, ny)) { tank.x = nx; tank.y = ny; }
}

function overlaps(a: Point, b: Point, distance = 0.58): boolean {
  return Math.abs(a.x - b.x) < distance && Math.abs(a.y - b.y) < distance;
}

export function firePlayer(state: GameState, playerId: string, now: number): boolean {
  const player = state.players[playerId];
  if (state.phase !== 'running' || !player?.alive || player.direction === 'none' || now < player.nextFireAt || Object.keys(state.bullets).length >= MAX_BULLETS) return false;
  const direction = player.direction;
  const delta = DIRECTIONS[direction];
  const id = nextId(state, `bullet:${player.id}`);
  state.bullets[id] = { id, ownerId: player.id, ownerKind: 'player', team: player.team, direction,
    x: player.x + delta.x * 0.55, y: player.y + delta.y * 0.55, speed: BULLET_SPEED, steelPiercing: player.armor > 0 };
  player.nextFireAt = now + (player.rapidFireUntil > now ? 220 : 480);
  return true;
}

function killPlayer(state: GameState, target: PlayerState, killerId: string | null, now: number): void {
  if (!target.alive || target.shieldUntil > now) return;
  if (target.armor > 0) { target.armor -= 1; target.shieldUntil = now + 500; return; }
  target.alive = false; target.input = 'none';
  if (killerId && state.players[killerId] && killerId !== target.id) state.players[killerId].kills += 1;
  const base = baseFor(state, target);
  target.respawnAt = base && base.hp > 0 ? now + RESPAWN_MS : null;
  target.eliminated = target.respawnAt === null;
}

function applyPowerUp(state: GameState, player: PlayerState, kind: PowerUpKind, now: number): void {
  if (kind === 'armor') player.armor = Math.min(3, player.armor + 1);
  if (kind === 'shield') player.shieldUntil = now + 8000;
  if (kind === 'rapidFire') player.rapidFireUntil = now + 10000;
  if (kind === 'bomb') Object.values(state.ai).forEach((ai) => { delete state.ai[ai.id]; player.aiKills += 1; });
  if (kind === 'fortify') {
    const base = baseFor(state, player);
    if (base && base.hp > 0) base.fortifiedUntil = now + 10000;
  }
}

function spawnAi(state: GameState, now: number): void {
  const map = MAP_BY_ID.get(state.config.mapId)!;
  const spawn = map.aiSpawns[state.sequence % map.aiSpawns.length];
  const id = nextId(state, 'ai');
  state.ai[id] = {
    id, x: spawn.x, y: spawn.y, hp: 1, direction: 'down', nextDecisionAt: now,
    nextFireAt: now + 2500, behavior: 'patrol', targetPlayerId: null, path: [],
    lastProgressX: spawn.x, lastProgressY: spawn.y, lastProgressAt: now,
    stuckSince: null, bulletId: null,
  };
}

function spawnPowerUp(state: GameState, now: number): void {
  const map = MAP_BY_ID.get(state.config.mapId)!;
  const spawn = map.powerUpSpawns[state.sequence % map.powerUpSpawns.length];
  const kinds: PowerUpKind[] = ['armor', 'shield', 'bomb', 'fortify', 'rapidFire'];
  const id = nextId(state, 'powerup');
  state.powerUps[id] = { id, x: spawn.x, y: spawn.y, kind: kinds[state.sequence % kinds.length], expiresAt: now + 12000 };
}

function aiPassable(state: GameState, x: number, y: number): boolean {
  const map = MAP_BY_ID.get(state.config.mapId)!;
  const index = Math.floor(y) * map.width + Math.floor(x);
  const tile = tileAt(map, x + .5, y + .5);
  return state.destroyedTiles.includes(index) || (tile !== 'brick' && tile !== 'steel' && tile !== 'water');
}

export function findPath(state: GameState, from: Point, to: Point): Point[] {
  const map = MAP_BY_ID.get(state.config.mapId)!;
  const start = [Math.floor(from.x), Math.floor(from.y)] as const;
  const goal = [Math.floor(to.x), Math.floor(to.y)] as const;
  const key = (x: number, y: number) => `${x},${y}`;
  const queue: Array<[number, number]> = [[...start]];
  const previous = new Map<string, [number, number] | null>([[key(...start), null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current[0] === goal[0] && current[1] === goal[1]) break;
    for (const delta of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = current[0] + delta[0]; const ny = current[1] + delta[1]; const nextKey = key(nx, ny);
      if (nx <= 0 || ny <= 0 || nx >= map.width - 1 || ny >= map.height - 1 || previous.has(nextKey) || !aiPassable(state, nx, ny)) continue;
      previous.set(nextKey, current); queue.push([nx, ny]);
    }
  }
  if (!previous.has(key(...goal))) return [];
  const result: Point[] = []; let current: [number, number] | null = [...goal];
  while (current && (current[0] !== start[0] || current[1] !== start[1])) { result.push(pointCenter(current[0], current[1])); current = previous.get(key(...current)) ?? null; }
  return result.reverse().slice(0, 12);
}

function pointCenter(x: number, y: number): Point { return { x: x + .5, y: y + .5 }; }

export function hasLineOfSight(state: GameState, ai: AiState, target: PlayerState): Exclude<Direction, 'none'> | null {
  const dx = target.x - ai.x; const dy = target.y - ai.y;
  if (Math.hypot(dx, dy) > 7) return null;
  const alignedX = Math.abs(dx) < .55; const alignedY = Math.abs(dy) < .55;
  if (!alignedX && !alignedY) return null;
  const direction: Exclude<Direction, 'none'> = alignedX ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right');
  const d = DIRECTIONS[direction]; const distance = Math.max(Math.abs(dx), Math.abs(dy));
  for (let step = .75; step < distance - .5; step += .25) if (blocksMovement(state, ai.x + d.x * step, ai.y + d.y * step)) return null;
  return direction;
}

function fireAiBullet(state: GameState, ai: AiState, direction: Exclude<Direction, 'none'>, now: number): void {
  if (ai.bulletId || now < ai.nextFireAt || Object.keys(state.bullets).length >= MAX_BULLETS) return;
  ai.direction = direction; const d = DIRECTIONS[direction]; const id = nextId(state, `bullet:${ai.id}`);
  state.bullets[id] = { id, ownerId: ai.id, ownerKind: 'ai', direction, x: ai.x + d.x * .5, y: ai.y + d.y * .5, speed: BULLET_SPEED * .75, steelPiercing: false };
  ai.bulletId = id; ai.nextFireAt = now + 2500 + (state.sequence % 7) * 250;
}

function brickAhead(state: GameState, ai: AiState): boolean {
  const map = MAP_BY_ID.get(state.config.mapId)!; const d = DIRECTIONS[ai.direction];
  const x = Math.floor(ai.x + d.x * .7); const y = Math.floor(ai.y + d.y * .7); const index = y * map.width + x;
  return !state.destroyedTiles.includes(index) && tileAt(map, x + .5, y + .5) === 'brick';
}

function stepAi(state: GameState, ai: AiState, now: number, dt: number): void {
  if (ai.bulletId && !state.bullets[ai.bulletId]) ai.bulletId = null;
  const living = Object.values(state.players).filter((player) => player.alive);
  if (now >= ai.nextDecisionAt || !state.players[ai.targetPlayerId ?? '']?.alive) {
    const target = living.sort((a, b) => Math.abs(a.x - ai.x) + Math.abs(a.y - ai.y) - Math.abs(b.x - ai.x) - Math.abs(b.y - ai.y))[0];
    ai.targetPlayerId = target?.id ?? null;
    ai.behavior = target && Math.hypot(target.x - ai.x, target.y - ai.y) <= 10 ? 'chase' : 'patrol';
    const destination = ai.behavior === 'chase' && target ? target : MAP_BY_ID.get(state.config.mapId)!.center;
    ai.path = findPath(state, ai, destination);
    ai.nextDecisionAt = now + 1200 + (state.sequence % 6) * 180;
  }
  const waypoint = ai.path[0];
  if (waypoint) {
    const dx = waypoint.x - ai.x; const dy = waypoint.y - ai.y;
    if (Math.abs(dx) < .14 && Math.abs(dy) < .14) ai.path.shift();
    else ai.direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }
  moveTank(state, ai, ai.direction, AI_SPEED, dt);
  if (Math.hypot(ai.x - ai.lastProgressX, ai.y - ai.lastProgressY) >= .08) {
    ai.lastProgressX = ai.x; ai.lastProgressY = ai.y; ai.lastProgressAt = now; ai.stuckSince = null;
  } else if (now - ai.lastProgressAt >= 600) {
    ai.stuckSince ??= now; ai.behavior = 'unstuck'; ai.path = [];
    ai.direction = (['up', 'right', 'down', 'left'] as const)[state.sequence++ % 4];
    ai.nextDecisionAt = now + 700;
    if (now - ai.stuckSince >= 2500) { ai.targetPlayerId = null; ai.stuckSince = now; }
  }
  const target = ai.targetPlayerId ? state.players[ai.targetPlayerId] : undefined;
  const fireDirection = target ? hasLineOfSight(state, ai, target) : null;
  if (fireDirection) fireAiBullet(state, ai, fireDirection, now);
  else if (brickAhead(state, ai)) fireAiBullet(state, ai, ai.direction, now);
}

function stepBullets(state: GameState, now: number, dt: number): void {
  const map = MAP_BY_ID.get(state.config.mapId)!;
  for (const bullet of Object.values(state.bullets)) {
    const d = DIRECTIONS[bullet.direction]; bullet.x += d.x * bullet.speed * dt; bullet.y += d.y * bullet.speed * dt;
    const tx = Math.floor(bullet.x); const ty = Math.floor(bullet.y); const index = ty * map.width + tx; const tile = tileAt(map, bullet.x, bullet.y);
    const fortified = Object.values(state.bases).some((base) => base.fortifiedUntil > now && base.protectionTiles.includes(index));
    const effectiveTile = fortified && tile === 'brick' ? 'steel' : tile;
    if (!state.destroyedTiles.includes(index) && (effectiveTile === 'brick' || effectiveTile === 'steel' || effectiveTile === 'water')) {
      if (effectiveTile === 'brick' || (effectiveTile === 'steel' && bullet.steelPiercing)) state.destroyedTiles.push(index);
      delete state.bullets[bullet.id]; continue;
    }
    let consumed = false;
    for (const player of Object.values(state.players)) {
      if (!player.alive || player.id === bullet.ownerId || !overlaps(bullet, player)) continue;
      if (bullet.ownerKind === 'player' && state.config.mode === 'team2v2' && player.team === bullet.team) { consumed = true; break; }
      killPlayer(state, player, bullet.ownerKind === 'player' ? bullet.ownerId : null, now); consumed = true; break;
    }
    if (consumed) { delete state.bullets[bullet.id]; continue; }
    for (const ai of Object.values(state.ai)) {
      if (bullet.ownerKind !== 'player' || !overlaps(bullet, ai)) continue;
      delete state.ai[ai.id]; const owner = state.players[bullet.ownerId]; if (owner) owner.aiKills += 1;
      consumed = true; break;
    }
    if (consumed) { delete state.bullets[bullet.id]; continue; }
    if (bullet.ownerKind === 'player') for (const base of Object.values(state.bases)) {
      const ownBase = state.config.mode === 'team2v2' ? base.team === bullet.team : base.ownerId === bullet.ownerId;
      if (ownBase || !overlaps(bullet, base, .7)) continue;
      base.hp = Math.max(0, base.hp - 1); delete state.bullets[bullet.id]; break;
    }
  }
}

function respawnAndCollect(state: GameState, now: number): void {
  const map = MAP_BY_ID.get(state.config.mapId)!; const players = Object.values(state.players);
  players.forEach((player, index) => {
    const base = baseFor(state, player);
    if (!player.alive && player.respawnAt && now >= player.respawnAt && base && base.hp > 0) {
      const spawn = state.config.mode === 'team2v2' ? map.teamSpawns[player.team][teamPlayers(state, player.team).findIndex((p) => p.id === player.id)] : map.ffaLayouts[players.length as 2 | 3 | 4].spawns[index];
      Object.assign(player, { alive: true, eliminated: false, x: spawn.x, y: spawn.y, respawnAt: null, shieldUntil: now + 1600 });
    }
    if (base?.hp === 0 && !player.alive) { player.respawnAt = null; player.eliminated = true; }
    if (player.alive) for (const powerUp of Object.values(state.powerUps)) if (overlaps(player, powerUp, .65)) {
      applyPowerUp(state, player, powerUp.kind, now); delete state.powerUps[powerUp.id];
    }
  });
  for (const powerUp of Object.values(state.powerUps)) if (powerUp.expiresAt <= now) delete state.powerUps[powerUp.id];
}

function factionResult(state: GameState): GameResult | null {
  if (state.config.mode === 'team2v2') {
    const aliveTeams = (['red', 'blue'] as const).filter((team) => {
      const base = state.bases[`team:${team}`]; return (base?.hp ?? 0) > 0 || teamPlayers(state, team).some((p) => p.alive);
    });
    return aliveTeams.length === 1 ? { winnerTeam: aliveTeams[0], draw: false, reason: 'elimination' } : aliveTeams.length === 0 ? { draw: true, reason: 'elimination' } : null;
  }
  const contenders = Object.values(state.players).filter((player) => (baseFor(state, player)?.hp ?? 0) > 0 || player.alive);
  return contenders.length === 1 ? { winnerId: contenders[0].id, draw: false, reason: 'elimination' } : contenders.length === 0 ? { draw: true, reason: 'elimination' } : null;
}

function timeoutResult(state: GameState): GameResult {
  const score = (players: PlayerState[], base: BaseState | undefined) => [(base?.hp ?? 0) > 0 ? 1 : 0, base?.hp ?? 0, players.filter((p) => p.alive).length, players.reduce((n, p) => n + p.kills, 0)];
  const compare = (a: number[], b: number[]) => a.findIndex((value, index) => value !== b[index]) < 0 ? 0 : a[a.findIndex((value, index) => value !== b[index])] - b[a.findIndex((value, index) => value !== b[index])];
  if (state.config.mode === 'team2v2') {
    const red = score(teamPlayers(state, 'red'), state.bases['team:red']); const blue = score(teamPlayers(state, 'blue'), state.bases['team:blue']); const result = compare(red, blue);
    return result === 0 ? { draw: true, reason: 'timeout' } : { winnerTeam: result > 0 ? 'red' : 'blue', draw: false, reason: 'timeout' };
  }
  const ranked = Object.values(state.players).map((player) => ({ player, score: score([player], baseFor(state, player)) })).sort((a, b) => compare(b.score, a.score));
  return ranked.length < 2 || compare(ranked[0].score, ranked[1].score) !== 0 ? { winnerId: ranked[0]?.player.id, draw: false, reason: 'timeout' } : { draw: true, reason: 'timeout' };
}

export function stepGame(state: GameState, now: number): void {
  if (state.phase !== 'running') return;
  const dt = Math.min(.1, Math.max(0, (now - (state.lastTickAt ?? now)) / 1000)); state.lastTickAt = now;
  for (const player of Object.values(state.players)) if (player.alive) moveTank(state, player as PlayerState & { direction: Exclude<Direction, 'none'> }, player.input, PLAYER_SPEED, dt);
  for (const ai of Object.values(state.ai)) stepAi(state, ai, now, dt);
  stepBullets(state, now, dt); respawnAndCollect(state, now);
  if (now >= state.nextAiSpawnAt && Object.keys(state.ai).length < MAX_AI) { spawnAi(state, now); state.nextAiSpawnAt = now + 18000 + (state.sequence % 8) * 1000; }
  if (now >= state.nextPowerUpAt && Object.keys(state.powerUps).length < MAX_POWER_UPS) { spawnPowerUp(state, now); state.nextPowerUpAt = now + 9000; }
  const result = factionResult(state) ?? (state.deadlineAt && now >= state.deadlineAt ? timeoutResult(state) : null);
  if (result) { state.phase = 'finished'; state.result = result; for (const player of Object.values(state.players)) player.input = 'none'; }
}

export function returnToLobby(state: GameState): void {
  state.phase = 'lobby'; state.bases = {}; state.bullets = {}; state.ai = {}; state.powerUps = {}; state.destroyedTiles = [];
  state.startedAt = null; state.deadlineAt = null; state.lastTickAt = null; state.result = null;
  Object.values(state.players).forEach((player) => Object.assign(player, { ready: false, alive: false, eliminated: false, input: 'none', respawnAt: null }));
}
