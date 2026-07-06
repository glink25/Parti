# PartiFlow

`@parti/flow` is Parti's isomorphic local-first game runtime. A game declares its state rules once; the browser predicts them and the fixed Parti worker protocol runs the same reducers authoritatively.

```ts
import { accept, createGameRuntime, createPartiSyncPlugin, defineGame } from '@parti/flow';

export const gameDefinition = defineGame({
  initialState: () => ({ shots: {} }),
  actions: {
    'player.shoot': {
      sync: { mode: 'hostRelay' },
      validate: (_ctx, shot) => accept(shot),
      reduce(ctx, shot) {
        ctx.state.shots[shot.id] = shot;
        ctx.emit('fx.shot', shot);
      },
    },
  },
});

const game = createGameRuntime(gameDefinition, { role: 'client', playerId: parti.playerId! });
game.use(createPartiSyncPlugin(parti));
game.action('player.shoot', { id: 'p1:shot:1', position: { x: 0, y: 0 } });
```

The worker entry contains no game rules:

```ts
import { createFlowRoom } from '@parti/flow/worker';
import { gameDefinition } from '../game';

export default createFlowRoom(gameDefinition);
```

Actions support `localOnly`, `optimisticBroadcast`, `hostRelay`, and `hostAuthoritative`. `validate` runs only at the authority boundary; `reduce` is shared by prediction and authority execution.
