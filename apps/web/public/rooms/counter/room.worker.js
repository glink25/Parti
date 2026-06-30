import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() {
    return {
      count: 0,
      clicks: {},
    };
  },

  onJoin(ctx, player) {
    ctx.state.clicks[player.id] = 0;
    ctx.log('joined', player.name);
  },

  onLeave(ctx, player) {
    delete ctx.state.clicks[player.id];
  },

  actions: {
    increment(ctx, { player }) {
      ctx.state.count += 1;
      ctx.state.clicks[player.id] = (ctx.state.clicks[player.id] || 0) + 1;

      ctx.broadcast('counter:incremented', {
        playerId: player.id,
        count: ctx.state.count,
      });
    },
  },
});
