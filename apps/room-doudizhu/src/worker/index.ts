import { defineRoom, type RoomContext } from '@parti/worker-sdk';
import { createDeck, removeCards, shuffle, sortCards } from './cards';
import { analyzePlay, canBeat, isMultiplierPlay } from './rules';
import type { Card, GameState, PlayRecord, PlayerState } from './types';

let hands: Record<string, Card[]> = {};
let landlordCardsHidden: Card[] = [];

export default defineRoom<GameState>({
  meta: { name: '斗地主', minPlayers: 3, maxPlayers: 3 },

  initialState() {
    return createInitialState();
  },

  onRestore(ctx) {
    resetRoundPublicState(ctx.state, '房间已恢复，请重新准备开始下一局');
    hands = {};
    landlordCardsHidden = [];
  },

  onJoin(ctx, player) {
    const existing = ctx.state.players[player.id];
    if (existing) {
      existing.connected = true;
      existing.name = player.name;
      sendHand(ctx, player.id);
      return;
    }

    const seat = ctx.state.seats.findIndex((id) => id === null);
    if (seat < 0) {
      ctx.kick(player.id, '房间已满');
      return;
    }

    ctx.state.seats[seat] = player.id;
    ctx.state.players[player.id] = {
      id: player.id,
      name: player.name,
      seat,
      ready: false,
      score: 0,
      connected: true,
      role: null,
    };
    ctx.state.message = playersCount(ctx.state) < 3 ? '等待三名玩家加入' : '请准备';
    if (playersCount(ctx.state) === 3 && ctx.state.phase === 'waiting') ctx.state.phase = 'ready';
  },

  onReconnect(ctx, player) {
    const statePlayer = ctx.state.players[player.id];
    if (statePlayer) {
      statePlayer.connected = true;
      statePlayer.name = player.name;
      sendHand(ctx, player.id);
    }
  },

  onLeave(ctx, player) {
    const statePlayer = ctx.state.players[player.id];
    if (!statePlayer) return;

    if (ctx.state.phase === 'bidding' || ctx.state.phase === 'playing') {
      statePlayer.connected = false;
      ctx.state.message = `${statePlayer.name} 离线，等待重连`;
      return;
    }

    ctx.state.seats[statePlayer.seat] = null;
    delete ctx.state.players[player.id];
    delete ctx.state.handCounts[player.id];
    delete hands[player.id];
    if (playersCount(ctx.state) < 3) {
      ctx.state.phase = 'waiting';
      ctx.state.message = '等待三名玩家加入';
    }
  },

  actions: {
    setReady(ctx, { player, payload }) {
      const me = ctx.state.players[player.id];
      if (!me || !canPrepare(ctx.state)) return;
      me.ready = Boolean(payload && payload.ready);
      ctx.state.message = '等待所有玩家准备';
      if (playersCount(ctx.state) === 3 && allPlayers(ctx.state).every((p) => p.ready)) {
        startRound(ctx);
      }
    },

    bid(ctx, { player, payload }) {
      if (ctx.state.phase !== 'bidding' || ctx.state.bidState?.currentPlayerId !== player.id) return;
      const score = Number(payload && payload.score);
      if (!Number.isInteger(score) || score < 0 || score > 3) return;
      if (score > 0 && score <= ctx.state.bidState.highestScore) return;

      const bid = ctx.state.bidState;
      bid.turns += 1;
      if (score === 0) {
        if (!bid.passed.includes(player.id)) bid.passed.push(player.id);
      } else {
        bid.highestScore = score;
        bid.highestPlayerId = player.id;
      }

      ctx.broadcast('game:notice', { message: `${ctx.state.players[player.id].name}${score === 0 ? '不叫' : `叫 ${score} 分`}` });

      if (score === 3 || bid.turns >= 3) {
        if (!bid.highestPlayerId) {
          ctx.broadcast('game:notice', { message: '无人叫地主，重新发牌' });
          startRound(ctx);
          return;
        }
        beginPlaying(ctx, bid.highestPlayerId, bid.highestScore);
        return;
      }

      bid.currentPlayerId = nextPlayerId(ctx.state, player.id);
    },

    playCards(ctx, { player, payload }) {
      if (ctx.state.phase !== 'playing' || ctx.state.currentPlayerId !== player.id) return;
      const ids = Array.isArray(payload?.cardIds) ? payload.cardIds.filter((id: unknown): id is string => typeof id === 'string') : [];
      const selected = removeCards(hands[player.id] ?? [], ids);
      if (!selected || selected.length === 0) {
        ctx.send(player.id, 'game:invalid', { message: '请选择要出的牌' });
        return;
      }

      const analysis = analyzePlay(selected);
      if (!analysis) {
        ctx.send(player.id, 'game:invalid', { message: '牌型不合法' });
        return;
      }
      if (!canBeat(analysis, ctx.state.lastPlay?.analysis ?? null)) {
        ctx.send(player.id, 'game:invalid', { message: '需要出同牌型更大的牌，或使用炸弹/火箭' });
        return;
      }

      hands[player.id] = sortCards((hands[player.id] ?? []).filter((card) => !ids.includes(card.id)));
      ctx.state.handCounts[player.id] = hands[player.id].length;
      ctx.state.round.playCounts[player.id] = (ctx.state.round.playCounts[player.id] ?? 0) + 1;
      if (isMultiplierPlay(analysis)) ctx.state.round.multiplier *= 2;

      const record: PlayRecord = {
        playerId: player.id,
        cards: sortCards(selected),
        analysis,
      };
      ctx.state.lastPlay = record;
      ctx.state.playedCards.push(record);
      ctx.state.round.passCount = 0;
      sendHand(ctx, player.id);

      if (hands[player.id].length === 0) {
        settleRound(ctx, player.id);
        return;
      }

      ctx.state.currentPlayerId = nextPlayerId(ctx.state, player.id);
    },

    pass(ctx, { player }) {
      if (ctx.state.phase !== 'playing' || ctx.state.currentPlayerId !== player.id) return;
      if (!ctx.state.lastPlay || ctx.state.lastPlay.playerId === player.id) return;

      ctx.state.playedCards.push({ playerId: player.id, pass: true });
      ctx.state.round.passCount += 1;
      if (ctx.state.round.passCount >= 2) {
        ctx.state.currentPlayerId = ctx.state.lastPlay.playerId;
        ctx.state.lastPlay = null;
        ctx.state.round.passCount = 0;
        return;
      }
      ctx.state.currentPlayerId = nextPlayerId(ctx.state, player.id);
    },

    syncHand(ctx, { player }) {
      sendHand(ctx, player.id);
    },
  },
});

function createInitialState(): GameState {
  return {
    phase: 'waiting',
    players: {},
    seats: [null, null, null],
    dealer: null,
    landlordCardsVisible: [],
    currentPlayerId: null,
    bidState: null,
    lastPlay: null,
    playedCards: [],
    handCounts: {},
    round: {
      number: 0,
      starterSeat: 0,
      passCount: 0,
      multiplier: 1,
      baseScore: 0,
      playCounts: {},
    },
    result: null,
    message: '等待三名玩家加入',
  };
}

function startRound(ctx: RoomContext<GameState>) {
  const state = ctx.state;
  const players = allPlayers(state);
  if (players.length !== 3) return;

  const deck = shuffle(createDeck(), () => ctx.random());
  hands = {};
  for (const player of players) hands[player.id] = sortCards(deck.splice(0, 17));
  landlordCardsHidden = deck.splice(0, 3);

  state.phase = 'bidding';
  state.dealer = null;
  state.landlordCardsVisible = [];
  state.currentPlayerId = null;
  state.lastPlay = null;
  state.playedCards = [];
  state.handCounts = Object.fromEntries(players.map((player) => [player.id, 17]));
  state.result = null;
  state.round = {
    number: state.round.number + 1,
    starterSeat: state.round.number % 3,
    passCount: 0,
    multiplier: 1,
    baseScore: 0,
    playCounts: Object.fromEntries(players.map((player) => [player.id, 0])),
  };
  for (const player of players) {
    player.ready = false;
    player.role = null;
    sendHand(ctx, player.id);
  }

  const starterId = state.seats[state.round.starterSeat] ?? players[0].id;
  state.bidState = {
    currentPlayerId: starterId,
    highestScore: 0,
    highestPlayerId: null,
    turns: 0,
    passed: [],
  };
  state.message = '开始叫地主';
  ctx.broadcast('game:notice', { message: '新一局开始，叫地主' });
}

function beginPlaying(ctx: RoomContext<GameState>, landlordId: string, baseScore: number) {
  const state = ctx.state;
  state.phase = 'playing';
  state.dealer = landlordId;
  state.landlordCardsVisible = sortCards(landlordCardsHidden);
  state.currentPlayerId = landlordId;
  state.bidState = null;
  state.round.baseScore = baseScore;
  state.round.multiplier = Math.max(1, baseScore);
  state.message = `${state.players[landlordId].name} 成为地主`;

  for (const player of allPlayers(state)) player.role = player.id === landlordId ? 'landlord' : 'farmer';
  hands[landlordId] = sortCards([...(hands[landlordId] ?? []), ...landlordCardsHidden]);
  state.handCounts[landlordId] = hands[landlordId].length;
  sendHand(ctx, landlordId);
  ctx.broadcast('game:notice', { message: `${state.players[landlordId].name} 成为地主` });
}

function settleRound(ctx: RoomContext<GameState>, winnerId: string) {
  const state = ctx.state;
  const landlordId = state.dealer;
  if (!landlordId) return;

  const landlordWon = winnerId === landlordId;
  const farmerIds = allPlayers(state).filter((player) => player.id !== landlordId).map((player) => player.id);
  const spring = landlordWon
    ? farmerIds.every((id) => (state.round.playCounts[id] ?? 0) === 0)
    : (state.round.playCounts[landlordId] ?? 0) <= 1;
  if (spring) state.round.multiplier *= 2;

  const unit = Math.max(1, state.round.baseScore) * state.round.multiplier;
  const deltas: Record<string, number> = {};
  if (landlordWon) {
    deltas[landlordId] = unit * 2;
    for (const id of farmerIds) deltas[id] = -unit;
  } else {
    deltas[landlordId] = -unit * 2;
    for (const id of farmerIds) deltas[id] = unit;
  }

  for (const [id, delta] of Object.entries(deltas)) {
    state.players[id].score += delta;
    state.players[id].ready = false;
  }

  state.phase = 'settlement';
  state.currentPlayerId = null;
  state.result = {
    winnerTeam: landlordWon ? 'landlord' : 'farmers',
    winnerIds: landlordWon ? [landlordId] : farmerIds,
    deltas,
    spring,
    multiplier: state.round.multiplier,
  };
  state.message = '本局结束，请准备下一局';
  ctx.broadcast('game:notice', { message: landlordWon ? '地主胜利' : '农民胜利' });
}

function resetRoundPublicState(state: GameState, message: string) {
  state.phase = playersCount(state) === 3 ? 'ready' : 'waiting';
  state.dealer = null;
  state.landlordCardsVisible = [];
  state.currentPlayerId = null;
  state.bidState = null;
  state.lastPlay = null;
  state.playedCards = [];
  state.handCounts = {};
  state.result = null;
  state.message = message;
  for (const player of allPlayers(state)) {
    player.ready = false;
    player.role = null;
  }
}

function canPrepare(state: GameState) {
  return playersCount(state) === 3 && (state.phase === 'ready' || state.phase === 'settlement');
}

function allPlayers(state: GameState): PlayerState[] {
  return state.seats.map((id) => (id ? state.players[id] : null)).filter((player): player is PlayerState => Boolean(player));
}

function playersCount(state: GameState) {
  return allPlayers(state).length;
}

function nextPlayerId(state: GameState, playerId: string) {
  const player = state.players[playerId];
  const nextSeat = (player.seat + 1) % 3;
  return state.seats[nextSeat] ?? playerId;
}

function sendHand(ctx: RoomContext<GameState>, playerId: string) {
  if (!hands[playerId]) return;
  ctx.send(playerId, 'hand:update', { hand: sortCards(hands[playerId]) });
}
