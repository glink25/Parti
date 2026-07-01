import { defineRoom } from '@parti/worker-sdk';

const MAX_MESSAGE_LENGTH = 500;

function appendMessage(ctx, msg) {
  const id = ctx.state.nextMsgId;
  ctx.state.nextMsgId += 1;
  ctx.state.messages.push({ id, ts: ctx.now(), ...msg });
}

export default defineRoom({
  meta: { name: '多人聊天', minPlayers: 1, maxPlayers: 16 },

  initialState() {
    return {
      messages: [],
      players: {},
      nextMsgId: 1,
    };
  },

  onJoin(ctx, player) {
    ctx.state.players[player.id] = { name: player.name, joinedAt: ctx.now() };
    appendMessage(ctx, {
      type: 'system',
      text: `${player.name} 加入了房间`,
    });
  },

  onLeave(ctx, player) {
    const p = ctx.state.players[player.id];
    if (p) {
      appendMessage(ctx, {
        type: 'system',
        text: `${p.name} 离开了房间`,
      });
    }
    delete ctx.state.players[player.id];
  },

  actions: {
    send(ctx, { player, payload }) {
      const text = String((payload && payload.text) || '').trim();
      if (!text || text.length > MAX_MESSAGE_LENGTH) return;

      appendMessage(ctx, {
        type: 'chat',
        authorId: player.id,
        authorName: player.name,
        text,
      });
    },
  },
});
