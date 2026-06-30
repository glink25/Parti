import { defineRoom } from '@parti/worker-sdk';

const WORDS = [
  { answer: 'parti', hint: '本平台的名字（5 个字母）' },
  { answer: 'runtime', hint: '负责运行房间的核心（7 个字母）' },
  { answer: 'worker', hint: '房间逻辑运行的地方（6 个字母）' },
];

// 权威答案只存在于房主 Worker 的内存里，永远不进入 state，因此不会被 snapshot
// 广播给玩家（MVP 的轻量「隐藏状态」做法，§22.5）。
let currentAnswer = null;

export default defineRoom({
  meta: { name: '猜词游戏', minPlayers: 1, maxPlayers: 8 },

  initialState() {
    return {
      phase: 'waiting', // waiting | playing | finished
      players: {}, // id -> { name, ready, score }
      hint: null,
      winner: null,
      lastGuess: null,
    };
  },

  onJoin(ctx, player) {
    ctx.state.players[player.id] = { name: player.name, ready: false, score: 0 };
  },

  onLeave(ctx, player) {
    delete ctx.state.players[player.id];
  },

  actions: {
    ready(ctx, { player }) {
      const p = ctx.state.players[player.id];
      if (!p || ctx.state.phase !== 'waiting') return;
      p.ready = true;

      const players = Object.values(ctx.state.players);
      const allReady = players.length > 0 && players.every((x) => x.ready);
      if (allReady) {
        const pick = WORDS[Math.floor(ctx.random() * WORDS.length)];
        currentAnswer = pick.answer;
        ctx.state.hint = pick.hint;
        ctx.state.phase = 'playing';
        ctx.state.winner = null;
        ctx.broadcast('game:start', { hint: pick.hint });
      }
    },

    guess(ctx, { player, payload }) {
      if (ctx.state.phase !== 'playing') return;
      const text = String(payload?.text ?? '').trim().toLowerCase();
      ctx.state.lastGuess = { playerId: player.id, text };

      if (text && text === currentAnswer) {
        ctx.state.phase = 'finished';
        ctx.state.winner = player.id;
        ctx.state.players[player.id].score += 1;
        ctx.broadcast('game:finished', { winner: player.id, answer: currentAnswer });
      } else {
        ctx.broadcast('guess:wrong', { playerId: player.id, text });
      }
    },

    restart(ctx) {
      ctx.state.phase = 'waiting';
      ctx.state.hint = null;
      ctx.state.winner = null;
      ctx.state.lastGuess = null;
      currentAnswer = null;
      for (const id of Object.keys(ctx.state.players)) {
        ctx.state.players[id].ready = false;
      }
      ctx.broadcast('game:reset', {});
    },
  },
});
