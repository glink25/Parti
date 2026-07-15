import { defineRoom, type RoomContext } from '@parti/worker-sdk';
import type { GameState, PrivateState, RoundResult, SeatState } from '../game/types';
import { analyzeWin, createDeck, rankReactions, scoreGang, scoreWin, seatDistance, shuffle, sortTiles, tileRank, tileSuit } from './rules';
import type { Meld, ReactionClaim, ReactionKind, RulesConfig, Tile, TileKind } from './types';

type SecretReaction = { discarderSeat: number; tile: Tile; eligible: Record<number, ReactionKind[]>; chiOptions: Record<number, TileKind[][]>; responses: Record<number, ReactionClaim | null>; robGang?: { seat: number; kind: TileKind } };

let hands: Record<number, Tile[]> = {};
let wall: Tile[] = [];
let reaction: SecretReaction | null = null;
let lastDrawWasGang = false;
let actionSequence = 0;
let roundStartingScores = [0,0,0,0];

const DEFAULT_RULES: RulesConfig = { winSource: 'both', allowChi: true, allowMultiWin: true, allowRobGang: true, allowLastTile: true, rounds: 4, baseScore: 1, maxFan: 8 };

export default defineRoom<GameState>({
  meta: { name: '超级麻将', minPlayers: 1, maxPlayers: 4 },
  initialState: () => initialState(),
  onRestore(ctx) {
    clearSecrets();
    ctx.state.phase = 'lobby'; ctx.state.currentSeat = null; ctx.state.reaction = null; ctx.state.lastDiscard = null; ctx.state.result = null;
    ctx.state.message = '房主恢复了房间，当前小局已安全中止，请重新准备';
    for (const seat of occupied(ctx.state)) { seat.ready = false; seat.handCount = 0; seat.melds = []; seat.discards = []; }
  },
  onJoin(ctx, player) {
    const existing = ctx.state.seats.find((seat) => seat?.id === player.id);
    if (existing) { existing.connected = true; existing.name = player.name; sendPrivate(ctx, existing.seat); return; }
    if (ctx.state.phase !== 'lobby') { ctx.kick(player.id, '牌局进行中'); return; }
    const index = ctx.state.seats.findIndex((seat) => seat === null || seat.bot);
    if (index < 0) { ctx.kick(player.id, '房间已满'); return; }
    ctx.state.seats[index] = makeSeat(player.id, player.name, index, false);
    if (!ctx.state.hostId) ctx.state.hostId = player.id;
    ctx.state.message = '调整规则，所有真人准备后即可开局';
  },
  onReconnect(ctx, player) {
    const seat = ctx.state.seats.find((candidate) => candidate?.id === player.id);
    if (seat) { seat.connected = true; seat.name = player.name; sendPrivate(ctx, seat.seat); }
  },
  onLeave(ctx, player) {
    const seat = ctx.state.seats.find((candidate) => candidate?.id === player.id);
    if (!seat) return;
    if (ctx.state.phase === 'lobby' || ctx.state.phase === 'matchEnd') ctx.state.seats[seat.seat] = null;
    else { seat.connected = false; seat.name = `${seat.name}（托管）`; scheduleBots(ctx); }
  },
  actions: {
    configureRules(ctx, { player, payload }) {
      if (ctx.state.phase !== 'lobby' || player.id !== ctx.state.hostId) return;
      ctx.state.rules = normalizeRules(payload, ctx.state.rules);
    },
    setReady(ctx, { player, payload }) {
      if (ctx.state.phase !== 'lobby') return;
      const seat = seatForPlayer(ctx.state, player.id); if (!seat) return;
      seat.ready = Boolean(payload?.ready);
    },
    startMatch(ctx, { player }) {
      if (ctx.state.phase !== 'lobby' || player.id !== ctx.state.hostId) return;
      const humans = occupied(ctx.state).filter((seat) => !seat.bot);
      if (humans.length === 0 || humans.some((seat) => !seat.ready)) { ctx.send(player.id, 'mahjong:notice', { message: '请等待所有真人准备' }); return; }
      fillBots(ctx.state); ctx.state.roundIndex = 0; ctx.state.dealerSeat = 0;
      for (const seat of occupied(ctx.state)) seat.score = 0;
      startRound(ctx);
    },
    discard(ctx, { player, payload }) {
      const seat = seatForPlayer(ctx.state, player.id); if (!seat || !seat.connected) return;
      discardFromSeat(ctx, seat.seat, String(payload?.tileId ?? ''));
    },
    passReaction(ctx, { player }) { submitHumanReaction(ctx, player.id, null); },
    chi(ctx, { player, payload }) { submitHumanReaction(ctx, player.id, { kind: 'chi', tiles: validIds(payload?.tileIds) }); },
    peng(ctx, { player }) { submitHumanReaction(ctx, player.id, { kind: 'peng' }); },
    gang(ctx, { player, payload }) {
      const seat = seatForPlayer(ctx.state, player.id); if (!seat || !seat.connected) return;
      if (ctx.state.phase === 'reaction') submitHumanReaction(ctx, player.id, { kind: 'gang' });
      else declareOwnGang(ctx, seat.seat, String(payload?.kind ?? ''));
    },
    declareWin(ctx, { player }) {
      const seat = seatForPlayer(ctx.state, player.id); if (!seat || !seat.connected) return;
      if (ctx.state.phase === 'reaction') submitHumanReaction(ctx, player.id, { kind: 'win' });
      else if (ctx.state.phase === 'playing' && ctx.state.currentSeat === seat.seat) settleWins(ctx, [seat.seat], null, false);
    },
    syncPrivate(ctx, { player }) { const seat = seatForPlayer(ctx.state, player.id); if (seat) sendPrivate(ctx, seat.seat); },
    nextRound(ctx, { player }) {
      if (player.id !== ctx.state.hostId || ctx.state.phase !== 'settlement') return;
      ctx.state.roundIndex += 1; ctx.state.dealerSeat = (ctx.state.dealerSeat + 1) % 4; startRound(ctx);
    },
    restartMatch(ctx, { player }) {
      if (player.id !== ctx.state.hostId || (ctx.state.phase !== 'matchEnd' && ctx.state.phase !== 'settlement')) return;
      clearSecrets(); ctx.state.phase = 'lobby'; ctx.state.roundIndex = 0; ctx.state.result = null; ctx.state.currentSeat = null;
      ctx.state.seats = ctx.state.seats.map((seat) => seat?.bot ? null : seat ? { ...seat, ready: false, score: 0, dealer: false, handCount: 0, melds: [], discards: [] } : null);
      ctx.state.message = '新比赛，请准备';
    },
  },
});

function initialState(): GameState { return { phase: 'lobby', rules: { ...DEFAULT_RULES }, seats: [null,null,null,null], hostId: null, roundIndex: 0, dealerSeat: 0, currentSeat: null, wallCount: 0, lastDiscard: null, reaction: null, result: null, message: '等待玩家加入' }; }
function makeSeat(id: string, name: string, seat: number, bot: boolean): SeatState { return { id, name, seat, bot, connected: true, ready: bot, score: 0, dealer: false, handCount: 0, melds: [], discards: [] }; }
function occupied(state: GameState) { return state.seats.filter((seat): seat is SeatState => Boolean(seat)); }
function seatForPlayer(state: GameState, id: string) { return state.seats.find((seat) => seat?.id === id) ?? null; }
function validIds(value: unknown) { return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; }

function normalizeRules(raw: any, current: RulesConfig): RulesConfig {
  const source = raw && typeof raw === 'object' ? raw : {};
  const winSource = ['both','selfDrawOnly','discardOnly'].includes(source.winSource) ? source.winSource : current.winSource;
  const rounds = [1,4,8].includes(Number(source.rounds)) ? Number(source.rounds) as 1|4|8 : current.rounds;
  return { winSource, rounds, allowChi: bool(source.allowChi, current.allowChi), allowMultiWin: bool(source.allowMultiWin, current.allowMultiWin), allowRobGang: bool(source.allowRobGang, current.allowRobGang), allowLastTile: bool(source.allowLastTile, current.allowLastTile), baseScore: clampInt(source.baseScore, 1, 10, current.baseScore), maxFan: clampInt(source.maxFan, 1, 16, current.maxFan) };
}
function bool(value: unknown, fallback: boolean) { return typeof value === 'boolean' ? value : fallback; }
function clampInt(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function fillBots(state: GameState) { for (let seat = 0; seat < 4; seat += 1) if (!state.seats[seat]) state.seats[seat] = makeSeat(`bot:${seat}`, `雀侠 ${seat + 1}`, seat, true); }

function startRound(ctx: RoomContext<GameState>) {
  roundStartingScores=ctx.state.seats.map(seat=>seat?.score??0);
  clearSecrets(); ctx.state.phase = 'dealing'; ctx.state.result = null; ctx.state.reaction = null; ctx.state.lastDiscard = null;
  wall = shuffle(createDeck(), () => ctx.random());
  for (const seat of occupied(ctx.state)) { hands[seat.seat] = sortTiles(wall.splice(0, 13)); seat.handCount = 13; seat.melds = []; seat.discards = []; seat.dealer = seat.seat === ctx.state.dealerSeat; seat.ready = false; }
  hands[ctx.state.dealerSeat]!.push(wall.shift()!); hands[ctx.state.dealerSeat] = sortTiles(hands[ctx.state.dealerSeat]!);
  ctx.state.seats[ctx.state.dealerSeat]!.handCount = 14; ctx.state.wallCount = wall.length; ctx.state.currentSeat = ctx.state.dealerSeat; ctx.state.phase = 'playing'; ctx.state.message = `第 ${ctx.state.roundIndex + 1}/${ctx.state.rules.rounds} 局 · 庄家出牌`;
  sendAllPrivate(ctx); broadcastActionFx(ctx, 'deal', ctx.state.dealerSeat, []); scheduleBots(ctx);
}

function discardFromSeat(ctx: RoomContext<GameState>, seatIndex: number, tileId: string) {
  if (ctx.state.phase !== 'playing' || ctx.state.currentSeat !== seatIndex) return;
  const index = hands[seatIndex]?.findIndex((tile) => tile.id === tileId) ?? -1; if (index < 0) return;
  const tile = hands[seatIndex]![index]!; if (tile.kind === 'z') { sendNotice(ctx, seatIndex, '万能红中不能打出'); return; }
  hands[seatIndex]!.splice(index, 1); const seat = ctx.state.seats[seatIndex]!; seat.handCount = hands[seatIndex]!.length; seat.discards.push(tile);
  ctx.state.lastDiscard = { seat: seatIndex, tile }; lastDrawWasGang = false;
  broadcastActionFx(ctx, 'discard', seatIndex, [tile.kind]);
  beginDiscardReaction(ctx, seatIndex, tile);
}

function beginDiscardReaction(ctx: RoomContext<GameState>, discarderSeat: number, tile: Tile) {
  const eligible: Record<number, ReactionKind[]> = {}; const chiOptions: Record<number, TileKind[][]> = {};
  for (const seat of occupied(ctx.state)) {
    if (seat.seat === discarderSeat) continue;
    const options: ReactionKind[] = []; const candidate = [...hands[seat.seat]!, tile];
    if (ctx.state.rules.winSource !== 'selfDrawOnly' && analyzeWin(candidate, seat.melds).winning) options.push('win');
    const same = hands[seat.seat]!.filter((item) => item.kind === tile.kind).length;
    if (tile.kind !== 'z' && same >= 3) options.push('gang'); else if (tile.kind !== 'z' && same >= 2) options.push('peng');
    if (ctx.state.rules.allowChi && seatDistance(seat.seat, discarderSeat) === 1) { const sequences = findChiOptions(hands[seat.seat]!, tile.kind); if (sequences.length) { options.push('chi'); chiOptions[seat.seat] = sequences; } }
    if (options.length) eligible[seat.seat] = options;
  }
  if (Object.keys(eligible).length === 0) { advanceAndDraw(ctx, discarderSeat); return; }
  reaction = { discarderSeat, tile, eligible, chiOptions, responses: {} }; publishReaction(ctx);
}

function publishReaction(ctx: RoomContext<GameState>) {
  if (!reaction) return; const awaitingSeats = Object.keys(reaction.eligible).map(Number).filter((seat) => !(seat in reaction!.responses));
  ctx.state.phase = 'reaction'; ctx.state.reaction = { discarderSeat: reaction.discarderSeat, tile: reaction.tile, awaitingSeats };
  ctx.state.message = '等待吃、碰、杠、胡响应'; sendAllPrivate(ctx); scheduleBots(ctx);
}

function submitHumanReaction(ctx: RoomContext<GameState>, playerId: string, choice: { kind: ReactionKind; tiles?: string[] } | null) {
  const seat = seatForPlayer(ctx.state, playerId); if (!seat || !reaction || !(seat.seat in reaction.eligible)) return;
  submitReaction(ctx, seat.seat, choice);
}
function submitReaction(ctx: RoomContext<GameState>, seat: number, choice: { kind: ReactionKind; tiles?: string[] } | null) {
  if (!reaction || seat in reaction.responses) return;
  if (!choice) reaction.responses[seat] = null;
  else if (reaction.eligible[seat]?.includes(choice.kind)) reaction.responses[seat] = { playerId: ctx.state.seats[seat]!.id, seat, kind: choice.kind, tiles: choice.tiles };
  else return;
  if (Object.keys(reaction.responses).length < Object.keys(reaction.eligible).length) { publishReaction(ctx); return; }
  resolveReaction(ctx);
}

function resolveReaction(ctx: RoomContext<GameState>) {
  if (!reaction) return; const current = reaction; const claims = Object.values(current.responses).filter((value): value is ReactionClaim => Boolean(value));
  if (claims.length === 0) {
    reaction = null; ctx.state.reaction = null;
    if (current.robGang) { completeAddedGang(ctx, current.robGang.seat, current.robGang.kind); return; }
    advanceAndDraw(ctx, current.discarderSeat); return;
  }
  const winners = rankReactions(claims, current.discarderSeat, ctx.state.rules.allowMultiWin);
  if (winners[0]?.kind === 'win') { reaction = null; ctx.state.reaction = null; settleWins(ctx, winners.map((winner) => winner.seat), current.discarderSeat, Boolean(current.robGang), current.tile); return; }
  const claim = winners[0]!; reaction = null; ctx.state.reaction = null;
  if (claim.kind === 'peng') claimPeng(ctx, claim.seat, current);
  else if (claim.kind === 'gang') claimDiscardGang(ctx, claim.seat, current);
  else claimChi(ctx, claim.seat, current, claim.tiles ?? []);
}

function claimPeng(ctx: RoomContext<GameState>, seat: number, source: SecretReaction) {
  const taken = takeKind(hands[seat]!, source.tile.kind, 2); if (!taken) return advanceAndDraw(ctx, source.discarderSeat);
  const meld: Meld = { kind: 'peng', tiles: [...taken, source.tile], fromSeat: source.discarderSeat };
  removeLastDiscard(ctx.state, source.discarderSeat); ctx.state.seats[seat]!.melds.push(meld); finishClaim(ctx, seat, 'peng', meld.tiles.map((tile) => tile.kind), '碰');
}
function claimDiscardGang(ctx: RoomContext<GameState>, seat: number, source: SecretReaction) {
  const taken = takeKind(hands[seat]!, source.tile.kind, 3); if (!taken) return advanceAndDraw(ctx, source.discarderSeat);
  removeLastDiscard(ctx.state, source.discarderSeat); ctx.state.seats[seat]!.melds.push({ kind: 'gang', tiles: [...taken, source.tile], fromSeat: source.discarderSeat }); applyGangScore(ctx, seat, 'discard', source.discarderSeat); drawReplacement(ctx, seat, 'discardGang', source.tile.kind, source.discarderSeat);
}
function claimChi(ctx: RoomContext<GameState>, seat: number, source: SecretReaction, tileIds: string[]) {
  if (seatDistance(seat, source.discarderSeat) !== 1) return advanceAndDraw(ctx, source.discarderSeat);
  const chosen = tileIds.map((id) => hands[seat]!.find((tile) => tile.id === id)).filter((tile): tile is Tile => Boolean(tile));
  const kinds = chosen.map((tile) => tile.kind).sort(); const allowed = source.chiOptions[seat]?.some((option) => [...option].sort().join() === kinds.join());
  if (chosen.length !== 2 || !allowed) return advanceAndDraw(ctx, source.discarderSeat);
  hands[seat] = hands[seat]!.filter((tile) => !tileIds.includes(tile.id)); removeLastDiscard(ctx.state, source.discarderSeat);
  const meldTiles = sortTiles([...chosen, source.tile]);
  ctx.state.seats[seat]!.melds.push({ kind: 'chi', tiles: meldTiles, fromSeat: source.discarderSeat }); finishClaim(ctx, seat, 'chi', meldTiles.map((tile) => tile.kind), '吃');
}
function finishClaim(ctx: RoomContext<GameState>, seat: number, kind: 'chi'|'peng', tiles: TileKind[], label: string) { ctx.state.currentSeat = seat; ctx.state.phase = 'playing'; ctx.state.seats[seat]!.handCount = hands[seat]!.length; ctx.state.message = `${ctx.state.seats[seat]!.name}${label}牌后出牌`; sendAllPrivate(ctx); broadcastActionFx(ctx, kind, seat, tiles); scheduleBots(ctx); }

function declareOwnGang(ctx: RoomContext<GameState>, seat: number, kindRaw: string) {
  if (ctx.state.phase !== 'playing' || ctx.state.currentSeat !== seat || kindRaw === 'z') return; const kind = kindRaw as TileKind;
  const concealed = hands[seat]!.filter((tile) => tile.kind === kind).length >= 4;
  const peng = ctx.state.seats[seat]!.melds.find((meld) => meld.kind === 'peng' && meld.tiles[0]?.kind === kind);
  if (concealed) { const tiles = takeKind(hands[seat]!, kind, 4)!; ctx.state.seats[seat]!.melds.push({ kind: 'gang', tiles, fromSeat: null, concealed: true }); applyGangScore(ctx, seat, 'concealed'); drawReplacement(ctx, seat, 'concealedGang', kind); return; }
  if (!peng || !hands[seat]!.some((tile) => tile.kind === kind)) return;
  if (ctx.state.rules.allowRobGang) {
    const eligible: Record<number, ReactionKind[]> = {};
    for (const other of occupied(ctx.state)) if (other.seat !== seat && ctx.state.rules.winSource !== 'selfDrawOnly' && analyzeWin([...hands[other.seat]!, hands[seat]!.find((tile) => tile.kind === kind)!], other.melds).winning) eligible[other.seat] = ['win'];
    if (Object.keys(eligible).length) { reaction = { discarderSeat: seat, tile: hands[seat]!.find((tile) => tile.kind === kind)!, eligible, chiOptions: {}, responses: {}, robGang: { seat, kind } }; publishReaction(ctx); return; }
  }
  completeAddedGang(ctx, seat, kind);
}
function completeAddedGang(ctx: RoomContext<GameState>, seat: number, kind: TileKind) { const tile = takeKind(hands[seat]!, kind, 1)?.[0]; const meld = ctx.state.seats[seat]!.melds.find((item) => item.kind === 'peng' && item.tiles[0]?.kind === kind); if (!tile || !meld) return; meld.kind = 'gang'; meld.tiles.push(tile); applyGangScore(ctx, seat, 'added'); drawReplacement(ctx, seat, 'addedGang', kind); }

function drawReplacement(ctx: RoomContext<GameState>, seat: number, kind: 'concealedGang'|'discardGang'|'addedGang', tile: TileKind, sourceSeat?: number) { lastDrawWasGang = true; broadcastActionFx(ctx, kind, seat, [tile], sourceSeat); drawForSeat(ctx, seat); }
function advanceAndDraw(ctx: RoomContext<GameState>, fromSeat: number) { drawForSeat(ctx, (fromSeat + 1) % 4); }
function drawForSeat(ctx: RoomContext<GameState>, seat: number) {
  if (wall.length === 0) { settleDraw(ctx); return; }
  const tile = wall.shift()!; hands[seat]!.push(tile); hands[seat] = sortTiles(hands[seat]!); ctx.state.seats[seat]!.handCount = hands[seat]!.length;
  ctx.state.wallCount = wall.length; ctx.state.currentSeat = seat; ctx.state.phase = 'playing'; ctx.state.reaction = null; ctx.state.message = `${ctx.state.seats[seat]!.name} 摸牌`;
  sendAllPrivate(ctx); broadcastActionFx(ctx, 'draw', seat, []); scheduleBots(ctx);
}

function settleWins(ctx: RoomContext<GameState>, winnerSeats: number[], sourceSeat: number | null, robGang: boolean, claimedTile?: Tile) {
  if (winnerSeats.length === 0) return; const deltas = [0,0,0,0]; const winners: RoundResult['winners'] = [];
  for (const seat of winnerSeats) {
    const winningTile = sourceSeat === null ? null : claimedTile ?? ctx.state.lastDiscard?.tile ?? null;
    const analysis = analyzeWin(sourceSeat === null ? hands[seat]! : [...hands[seat]!, winningTile!], ctx.state.seats[seat]!.melds);
    if (!analysis.winning) continue;
    const scored = scoreWin(ctx.state.rules, { ...analysis, selfDraw: sourceSeat === null, gangBloom: sourceSeat === null && lastDrawWasGang, robGang, lastTile: ctx.state.rules.allowLastTile && wall.length === 0 });
    if (sourceSeat === null) {
      for (let payer = 0; payer < 4; payer += 1) if (payer !== seat) { deltas[payer] -= scored.points; deltas[seat] += scored.points; }
    } else {
      deltas[sourceSeat] -= scored.points; deltas[seat] += scored.points;
    }
    winners.push({ seat, sourceSeat, points: scored.points, fan: scored.fan, patterns: scored.patterns.map((pattern) => pattern.name).concat(robGang ? ['抢杠胡×2'] : [], ctx.state.rules.allowLastTile && wall.length === 0 ? ['海底×2'] : []) });
  }
  if (!winners.length) return;
  finishRound(ctx, { draw: false, winners, deltas, message: winners.map((winner) => `${ctx.state.seats[winner.seat]!.name} 胡牌`).join('、') });
}
function settleDraw(ctx: RoomContext<GameState>) { finishRound(ctx, { draw: true, winners: [], deltas: [0,0,0,0], message: '牌墙耗尽，本局流局' }); }
function finishRound(ctx: RoomContext<GameState>, result: RoundResult) { result.deltas.forEach((delta, seat) => { if (ctx.state.seats[seat]) ctx.state.seats[seat]!.score += delta; }); result.deltas=ctx.state.seats.map((seat,index)=>seat?seat.score-(roundStartingScores[index]??0):0);ctx.state.result = result; ctx.state.currentSeat = null; ctx.state.reaction = null; ctx.state.phase = ctx.state.roundIndex + 1 >= ctx.state.rules.rounds ? 'matchEnd' : 'settlement'; ctx.state.message = result.message; if (result.draw) broadcastActionFx(ctx, 'drawGame', ctx.state.dealerSeat, [], undefined, result.message); else for (const winner of result.winners) broadcastActionFx(ctx, 'win', winner.seat, [], winner.sourceSeat ?? undefined, `${ctx.state.seats[winner.seat]?.name ?? '玩家'} ${winner.sourceSeat === null ? '自摸' : '胡牌'} · ${winner.patterns.join(' · ')}`); ctx.broadcast('mahjong:settlement', result); clearRoundTimer(ctx); sendAllPrivate(ctx); }

function applyGangScore(ctx: RoomContext<GameState>, winnerSeat: number, kind: 'concealed'|'added'|'discard', sourceSeat?: number) { const score = scoreGang(kind, ctx.state.rules.baseScore); if (kind === 'discard' && sourceSeat !== undefined) { ctx.state.seats[sourceSeat]!.score -= score.payments[0]!; ctx.state.seats[winnerSeat]!.score += score.winner; } else { for (let seat = 0; seat < 4; seat += 1) if (seat !== winnerSeat) ctx.state.seats[seat]!.score -= score.payments[0]!; ctx.state.seats[winnerSeat]!.score += score.winner; } }
function takeKind(source: Tile[], kind: TileKind, count: number) { const found = source.filter((tile) => tile.kind === kind).slice(0, count); if (found.length !== count) return null; const ids = new Set(found.map((tile) => tile.id)); source.splice(0, source.length, ...source.filter((tile) => !ids.has(tile.id))); return found; }
function removeLastDiscard(state: GameState, seat: number) { state.seats[seat]!.discards.pop(); }

function findChiOptions(hand: Tile[], kind: TileKind): TileKind[][] { if (kind === 'z') return []; const suit = tileSuit(kind)!; const rank = tileRank(kind); const kinds = new Set(hand.map((tile) => tile.kind)); const options: TileKind[][] = []; for (const start of [rank - 2, rank - 1, rank]) { if (start < 1 || start > 7) continue; const sequence = [start,start+1,start+2].map((value) => `${suit}${value}` as TileKind).filter((value) => value !== kind); if (sequence.every((value) => kinds.has(value))) options.push(sequence); } return options; }
function ownGangKinds(seat: number, melds: Meld[]) { const counts = new Map<TileKind, number>(); for (const tile of hands[seat] ?? []) counts.set(tile.kind, (counts.get(tile.kind) ?? 0) + 1); return { concealed: [...counts].filter(([kind,count]) => kind !== 'z' && count >= 4).map(([kind]) => kind), added: melds.filter((meld) => meld.kind === 'peng').map((meld) => meld.tiles[0]!.kind).filter((kind) => counts.has(kind)) }; }
function privateFor(state: GameState, seat: number): PrivateState { const gangs = ownGangKinds(seat, state.seats[seat]?.melds ?? []); const selfCanWin = state.phase === 'playing' && state.currentSeat === seat && state.rules.winSource !== 'discardOnly' && analyzeWin(hands[seat] ?? [], state.seats[seat]?.melds ?? []).winning; return { hand: sortTiles(hands[seat] ?? []), canWin: selfCanWin, concealedGangKinds: gangs.concealed, addedGangKinds: gangs.added, reactionOptions: reaction?.eligible[seat] ?? [], chiOptions: reaction?.chiOptions[seat] ?? [] }; }
function sendPrivate(ctx: RoomContext<GameState>, seat: number) { const player = ctx.state.seats[seat]; if (player && !player.bot && player.connected) ctx.send(player.id, 'mahjong:private-state', privateFor(ctx.state, seat)); }
function sendAllPrivate(ctx: RoomContext<GameState>) { for (const seat of occupied(ctx.state)) sendPrivate(ctx, seat.seat); }
function sendNotice(ctx: RoomContext<GameState>, seat: number, message: string) { const player = ctx.state.seats[seat]; if (player && !player.bot) ctx.send(player.id, 'mahjong:notice', { message }); }
function broadcastActionFx(ctx: RoomContext<GameState>, kind: string, actorSeat: number, tiles: TileKind[], sourceSeat?: number, label?: string) { const occurredAt = Date.now(); ctx.broadcast('mahjong:action-fx', { actionId: `mahjong:${occurredAt}:${++actionSequence}`, occurredAt, kind, actorSeat, actorName: ctx.state.seats[actorSeat]?.name ?? '玩家', sourceSeat, tiles, label }); }

function scheduleBots(ctx: RoomContext<GameState>) { ctx.clearTimer('mahjong:bot'); ctx.setTimer('mahjong:bot', 800 + Math.floor(ctx.random() * 700), () => runBots(ctx)); }
function clearRoundTimer(ctx: RoomContext<GameState>) { ctx.clearTimer('mahjong:bot'); }
function controlledByBot(state: GameState, seat: number) { const player = state.seats[seat]; return Boolean(player && (player.bot || !player.connected)); }
function runBots(ctx: RoomContext<GameState>) {
  if (ctx.state.phase === 'reaction' && reaction) { const pending = Object.keys(reaction.eligible).map(Number).find((seat) => !(seat in reaction!.responses) && controlledByBot(ctx.state, seat)); if (pending !== undefined) { const options = reaction.eligible[pending]!; const kind = options.includes('win') ? 'win' : options.includes('gang') ? 'gang' : options.includes('peng') && botShouldMeld(pending, reaction.tile.kind) ? 'peng' : options.includes('chi') && botShouldChi(pending, reaction.chiOptions[pending] ?? []) ? 'chi' : null; const tiles = kind === 'chi' ? idsForKinds(hands[pending]!, reaction.chiOptions[pending]![0]!) : undefined; submitReaction(ctx, pending, kind ? { kind, tiles } : null); return; } }
  if (ctx.state.phase !== 'playing' || ctx.state.currentSeat === null || !controlledByBot(ctx.state, ctx.state.currentSeat)) return;
  const seat = ctx.state.currentSeat; const privateState = privateFor(ctx.state, seat); if (privateState.canWin) { settleWins(ctx, [seat], null, false); return; }
  const gangKind = privateState.concealedGangKinds[0] ?? privateState.addedGangKinds[0]; if (gangKind && ctx.random() < .65) { declareOwnGang(ctx, seat, gangKind); return; }
  const discard = chooseBotDiscard(hands[seat]!); if (discard) discardFromSeat(ctx, seat, discard.id);
}
function botShouldMeld(seat: number, kind: TileKind) { return handUsefulness(hands[seat]!, kind) >= 2; }
function botShouldChi(_seat: number, options: TileKind[][]) { return options.length > 0; }
function idsForKinds(hand: Tile[], kinds: TileKind[]) { const used = new Set<string>(); return kinds.map((kind) => { const tile = hand.find((candidate) => candidate.kind === kind && !used.has(candidate.id))!; used.add(tile.id); return tile.id; }); }
function chooseBotDiscard(hand: Tile[]) { const candidates = hand.filter((tile) => tile.kind !== 'z'); return candidates.sort((a,b) => handUsefulness(hand, a.kind) - handUsefulness(hand, b.kind) || b.id.localeCompare(a.id))[0]; }
function handUsefulness(hand: Tile[], kind: TileKind) { if (kind === 'z') return 99; const same = hand.filter((tile) => tile.kind === kind).length; const suit = tileSuit(kind); const rank = tileRank(kind); const neighbors = hand.filter((tile) => tileSuit(tile.kind) === suit && Math.abs(tileRank(tile.kind) - rank) <= 2).length; return same * 3 + neighbors; }
function clearSecrets() { hands = {}; wall = []; reaction = null; lastDrawWasGang = false; }
