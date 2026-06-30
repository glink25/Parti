import { defineRoom } from '@parti/worker-sdk';

// ============================================================================
// 牌模型 —— 纯常量 / 纯函数，放模块顶层（不进 state）。
// rank 排序值：3..10 → 3..10，J=11,Q=12,K=13,A=14,2=15，小王=16，大王=17。
// ============================================================================
const SUITS = ['♠', '♥', '♣', '♦']; // ♠ ♥ ♣ ♦

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 3; rank <= 15; rank++) {
      deck.push({ id: suit + rank, rank, suit });
    }
  }
  deck.push({ id: 'joker-small', rank: 16, suit: '' });
  deck.push({ id: 'joker-big', rank: 17, suit: '' });
  return deck;
}

// Fisher–Yates，rng 注入（用 ctx.random）。
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function sortHand(cards) {
  return cards.slice().sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
}

// 点数 → 张数 计数表
function rankCounts(cards) {
  const counts = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
  return counts;
}

function isConsecutive(ranks, maxAllowed) {
  // ranks: 升序去重数组。要求连续，且最大点数 <= maxAllowed（顺子/连对/飞机不含 2 和王）。
  if (ranks.length === 0) return false;
  if (ranks[ranks.length - 1] > maxAllowed) return false;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

// ============================================================================
// 牌型解析：返回 { type, mainRank, length } 或 null（非法）。
// ============================================================================
function parsePlay(cards) {
  const n = cards.length;
  if (n === 0) return null;

  const counts = rankCounts(cards);
  const ranks = Object.keys(counts).map(Number);
  const quads = ranks.filter((r) => counts[r] === 4);
  const trips = ranks.filter((r) => counts[r] === 3);
  const pairs = ranks.filter((r) => counts[r] === 2);
  const singles = ranks.filter((r) => counts[r] === 1);

  // 王炸
  if (n === 2 && counts[16] === 1 && counts[17] === 1) {
    return { type: 'rocket', mainRank: 17, length: 1 };
  }
  // 炸弹
  if (n === 4 && quads.length === 1) {
    return { type: 'bomb', mainRank: quads[0], length: 1 };
  }
  // 单 / 对 / 三
  if (n === 1) return { type: 'single', mainRank: ranks[0], length: 1 };
  if (n === 2 && pairs.length === 1) return { type: 'pair', mainRank: pairs[0], length: 1 };
  if (n === 3 && trips.length === 1) return { type: 'triple', mainRank: trips[0], length: 1 };
  // 三带一 / 三带二
  if (n === 4 && trips.length === 1 && singles.length === 1) {
    return { type: 'triple1', mainRank: trips[0], length: 1 };
  }
  if (n === 5 && trips.length === 1 && pairs.length === 1) {
    return { type: 'triple2', mainRank: trips[0], length: 1 };
  }
  // 四带两单 / 四带两对
  if (n === 6 && quads.length === 1 && singles.length === 2) {
    return { type: 'four2single', mainRank: quads[0], length: 1 };
  }
  if (n === 8 && quads.length === 1 && pairs.length === 2) {
    return { type: 'four2pair', mainRank: quads[0], length: 1 };
  }
  // 顺子（≥5 张单牌，连续，≤A）
  if (n >= 5 && singles.length === n) {
    const sorted = ranks.slice().sort((a, b) => a - b);
    if (isConsecutive(sorted, 14)) {
      return { type: 'straight', mainRank: sorted[sorted.length - 1], length: n };
    }
  }
  // 连对（≥3 对，连续，≤A）
  if (n >= 6 && n % 2 === 0 && pairs.length === n / 2) {
    const sorted = pairs.slice().sort((a, b) => a - b);
    if (isConsecutive(sorted, 14)) {
      return { type: 'pairStraight', mainRank: sorted[sorted.length - 1], length: sorted.length };
    }
  }
  // 飞机族：核心 = 连续的三张（count===3），≤A，长度 m≥2。
  const core = trips.slice().sort((a, b) => a - b);
  if (core.length >= 2 && isConsecutive(core, 14)) {
    const m = core.length;
    const top = core[m - 1];
    const remaining = n - 3 * m;
    if (remaining === 0) {
      return { type: 'plane', mainRank: top, length: m }; // 纯飞机
    }
    if (remaining === m) {
      return { type: 'plane1', mainRank: top, length: m }; // 飞机带单
    }
    if (remaining === 2 * m && pairs.length === m) {
      return { type: 'plane2', mainRank: top, length: m }; // 飞机带对
    }
  }
  return null;
}

// 能否压过上一手
function canBeat(prev, cur) {
  if (cur.type === 'rocket') return true;
  if (prev.type === 'rocket') return false;
  if (cur.type === 'bomb') {
    if (prev.type === 'bomb') return cur.mainRank > prev.mainRank;
    return true;
  }
  if (prev.type === 'bomb') return false;
  if (cur.type === prev.type && cur.length === prev.length) {
    return cur.mainRank > prev.mainRank;
  }
  return false;
}

// ============================================================================
// 隐藏状态（不进 state，不广播）
// ============================================================================
let hands = {}; // pid -> Card[]
let bottomHidden = []; // 发牌后留出的 3 张底牌，确定地主前不亮

// ============================================================================
// 工具：座位轮转
// ============================================================================
function nextPid(state, pid) {
  const i = state.seats.indexOf(pid);
  for (let k = 1; k <= 3; k++) {
    const cand = state.seats[(i + k) % 3];
    if (cand) return cand;
  }
  return null;
}

function sendHand(ctx, pid) {
  hands[pid] = sortHand(hands[pid] || []);
  ctx.send(pid, 'game:hand', { cards: hands[pid] });
  if (ctx.state.players[pid]) ctx.state.players[pid].cardCount = hands[pid].length;
}

// 发牌并进入叫分阶段
function startDeal(ctx) {
  const state = ctx.state;
  const deck = shuffle(buildDeck(), () => ctx.random());
  hands = {};
  for (let i = 0; i < 3; i++) {
    hands[state.seats[i]] = sortHand(deck.slice(i * 17, i * 17 + 17));
  }
  bottomHidden = deck.slice(51, 54);

  for (const pid of state.seats) {
    const p = state.players[pid];
    p.role = null;
    p.bid = null;
    p.cardCount = 17;
    sendHand(ctx, pid);
  }

  state.phase = 'bidding';
  state.turn = state.seats[0];
  state.landlord = null;
  state.bottomCards = null;
  state.lastPlay = null;
  state.passesInRow = 0;
  state.bidScore = 0;
  state.bidsMade = 0;
  state.highestBidder = null;
  state.multiplier = 0;
  state.result = null;
  state.log = ['开始发牌，等待叫分'];
  ctx.broadcast('game:start', {});
}

// 叫分结束，确定地主（或流局重发）
function finalizeBidding(ctx) {
  const state = ctx.state;
  if (state.bidScore === 0 || !state.highestBidder) {
    state.log.push('无人叫地主，重新发牌');
    ctx.broadcast('game:redeal', {});
    startDeal(ctx);
    return;
  }
  const landlord = state.highestBidder;
  state.landlord = landlord;
  for (const pid of state.seats) {
    state.players[pid].role = pid === landlord ? 'landlord' : 'farmer';
  }
  // 地主拿底牌
  hands[landlord] = sortHand(hands[landlord].concat(bottomHidden));
  state.bottomCards = bottomHidden.slice(); // 亮给所有人
  bottomHidden = [];
  sendHand(ctx, landlord);

  state.phase = 'playing';
  state.turn = landlord;
  state.lastPlay = null;
  state.passesInRow = 0;
  state.multiplier = state.bidScore; // 底分倍数 = 叫分
  state.log.push(`${state.players[landlord].name} 成为地主（${state.bidScore} 分）`);
  ctx.broadcast('game:landlord', { landlord, score: state.bidScore });
}

// 结算
function settle(ctx, winnerPid) {
  const state = ctx.state;
  const winnerRole = state.players[winnerPid].role;
  const v = state.multiplier;
  const delta = {};
  for (const pid of state.seats) {
    const isLandlord = state.players[pid].role === 'landlord';
    let d;
    if (isLandlord) d = winnerRole === 'landlord' ? 2 * v : -2 * v;
    else d = winnerRole === 'farmer' ? v : -v;
    delta[pid] = d;
    state.players[pid].score += d;
  }
  state.phase = 'finished';
  state.turn = null;
  state.result = { winnerRole, landlord: state.landlord, delta, multiplier: v };
  state.log.push(winnerRole === 'landlord' ? '地主获胜' : '农民获胜');
  ctx.broadcast('game:over', { winnerRole, delta });
}

// ============================================================================
// 房间定义
// ============================================================================
export default defineRoom({
  meta: { name: '斗地主', minPlayers: 3, maxPlayers: 3 },

  initialState() {
    return {
      phase: 'waiting', // waiting | bidding | playing | finished
      seats: [null, null, null],
      players: {}, // pid -> { name, seat, cardCount, role, bid, score }
      turn: null,
      landlord: null,
      bottomCards: null, // 确定地主后亮出的 3 张
      lastPlay: null, // { by, cards, play:{type,mainRank,length} }
      passesInRow: 0,
      bidScore: 0,
      bidsMade: 0,
      highestBidder: null,
      multiplier: 0,
      result: null,
      log: [],
    };
  },

  onJoin(ctx, player) {
    const state = ctx.state;
    let seat = -1;
    for (let i = 0; i < 3; i++) {
      if (!state.seats[i]) {
        seat = i;
        break;
      }
    }
    if (seat === -1) return; // 满了（理论上 Runtime 已挡住）
    state.seats[seat] = player.id;
    state.players[player.id] = {
      name: player.name,
      seat,
      cardCount: 0,
      role: null,
      bid: null,
      score: state.players[player.id] ? state.players[player.id].score : 0,
    };
    // 三座坐满且处于等待 → 开局发牌
    if (state.seats.every((s) => s) && state.phase === 'waiting') {
      startDeal(ctx);
    }
  },

  onLeave(ctx, player) {
    const state = ctx.state;
    const seat = state.seats.indexOf(player.id);
    if (seat !== -1) state.seats[seat] = null;
    delete state.players[player.id];
    delete hands[player.id];
    // 对局未结束时有人离开 → 回到等待，清局
    if (state.phase !== 'waiting') {
      state.phase = 'waiting';
      state.turn = null;
      state.landlord = null;
      state.bottomCards = null;
      state.lastPlay = null;
      state.passesInRow = 0;
      state.bidScore = 0;
      state.bidsMade = 0;
      state.highestBidder = null;
      state.multiplier = 0;
      state.result = null;
      hands = {};
      bottomHidden = [];
      for (const pid of state.seats) {
        if (pid && state.players[pid]) {
          state.players[pid].cardCount = 0;
          state.players[pid].role = null;
          state.players[pid].bid = null;
        }
      }
      state.log = ['有玩家离开，等待补位'];
    }
  },

  actions: {
    // payload: { score: 0 | 1 | 2 | 3 }  (0 = 不叫)
    bid(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== 'bidding') return;
      if (player.id !== state.turn) return;
      const score = Number(payload && payload.score);
      // 合法叫分：0（不叫）或 高于当前最高分且 ≤3
      if (![0, 1, 2, 3].includes(score)) return;
      if (score !== 0 && score <= state.bidScore) return;

      state.players[player.id].bid = score;
      state.bidsMade += 1;
      if (score > state.bidScore) {
        state.bidScore = score;
        state.highestBidder = player.id;
      }
      state.log.push(`${player.name} ${score === 0 ? '不叫' : '叫 ' + score + ' 分'}`);

      if (score === 3 || state.bidsMade >= 3) {
        finalizeBidding(ctx);
        return;
      }
      state.turn = nextPid(state, player.id);
    },

    // payload: { cardIds: string[] }
    play(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== 'playing') return;
      if (player.id !== state.turn) return;

      const ids = payload && payload.cardIds;
      if (!Array.isArray(ids) || ids.length === 0) return;
      const myHand = hands[player.id] || [];
      const idSet = new Set(ids);
      if (idSet.size !== ids.length) return; // 重复 id
      const selected = myHand.filter((c) => idSet.has(c.id));
      if (selected.length !== ids.length) return; // 有牌不在手里

      const play = parsePlay(selected);
      if (!play) return; // 非法牌型

      const isLead = state.lastPlay === null;
      if (!isLead && !canBeat(state.lastPlay.play, play)) return; // 压不过

      // 合法 —— 从手牌移除
      hands[player.id] = myHand.filter((c) => !idSet.has(c.id));
      sendHand(ctx, player.id);

      state.lastPlay = { by: player.id, cards: sortHand(selected), play };
      state.passesInRow = 0;

      if (play.type === 'bomb' || play.type === 'rocket') {
        state.multiplier *= 2;
        state.log.push(`${player.name} ${play.type === 'rocket' ? '王炸' : '炸弹'}！倍数翻倍`);
        ctx.broadcast('game:bomb', { by: player.id, type: play.type });
      }

      if (hands[player.id].length === 0) {
        settle(ctx, player.id);
        return;
      }
      state.turn = nextPid(state, player.id);
    },

    pass(ctx, { player }) {
      const state = ctx.state;
      if (state.phase !== 'playing') return;
      if (player.id !== state.turn) return;
      if (state.lastPlay === null) return; // 自由出（首家）不能不出

      state.passesInRow += 1;
      if (state.passesInRow >= 2) {
        // 其余两家都过 —— 桌面清空，回到上一手出牌人自由出
        state.turn = state.lastPlay.by;
        state.lastPlay = null;
        state.passesInRow = 0;
        state.log.push('一圈过，重新出牌');
      } else {
        state.turn = nextPid(state, player.id);
        state.log.push(`${player.name} 不出`);
      }
    },

    // 结束后重开：保留座位与累计分
    restart(ctx, { player }) {
      const state = ctx.state;
      if (state.phase !== 'finished') return;
      if (!state.players[player.id]) return;
      if (!state.seats.every((s) => s)) return;
      startDeal(ctx);
    },
  },
});
