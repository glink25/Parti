# PartiFlow 实战指南：基于当前 `@parti/flow` 构建本地优先多人游戏

> 本文对应仓库内 `packages/flow` 的真实实现，而不是未来 API 设想。
>
> 适用版本：`@parti/flow@0.1.0`。

## 0. 设计目标

PartiFlow 用于开发本地优先、即时反馈、由 Parti Worker 做最终裁决的轻量多人游戏。

适合：

- 聚会小游戏、合作 PVE、轻量动作游戏；
- 实时互动、多人创作、卡牌、答题；
- 可以接受短暂差异、最终由权威状态收敛的游戏。

不适合直接承担：

- 竞技级反作弊；
- 帧级确定性回滚；
- 每一帧强一致；
- 大规模服务端物理模拟。

PartiFlow 当前最重要的原则是：

```text
游戏规则通过 GameDefinition 定义一次。
客户端用同一个 reducer 做预测。
Worker 用同一个 reducer 做权威执行。
validate 只负责 Worker 的不可信输入边界。
```

---

# 1. 核心理念

## 1.1 本地优先

对于需要即时手感的行为，客户端先执行 `reduce`，不等待 Worker：

```ts
game.action('player.shoot', {
  shotId: `${game.playerId}:shot:${sequence}`,
  x,
  y,
});
```

`optimisticBroadcast` 和 `hostRelay` 会在本地立即执行 reducer；同步插件随后将 action 发给 Worker。

`hostAuthoritative` 不会本地执行 reducer，而是等待 Worker 返回同一个 action 后执行。

## 1.2 近似同步与最终收敛

客户端 reducer 可以临时修改本地 state 或生成表现。Worker 完成 action 后，Parti 原有 RoomEngine 会发送完整权威 state，`createPartiSyncPlugin()` 将其写入客户端 `StateStore`。

因此：

- 投射物、动画、远端插值可以近似；
- 血量、死亡、掉落、Boss 阶段最终以 Worker state 为准；
- 不需要手工广播快照。

## 1.3 同步行为原因，不同步表现指令

推荐同步：

```ts
game.action('combat.hit', {
  hitId,
  targetId,
  damage,
});
```

不推荐同步：

```ts
game.action('ui.showDamageNumber', { ... });
```

表现应由 reducer 派生本地 Event：

```ts
reduce(ctx, payload) {
  ctx.state.enemies[payload.targetId].hp -= payload.damage;
  ctx.emit('fx.hit', payload);
}
```

---

# 2. PartiFlow 的定位

PartiFlow 由两部分组成：

```text
@parti/flow
  ├─ defineGame / createGameRuntime
  ├─ ActionRegistry / StateStore / EventBus
  ├─ World / Systems / Plugins
  └─ createPartiSyncPlugin

@parti/flow/worker
  └─ createFlowRoom
       ↓
     固定的 @parti/worker-sdk RoomDefinition
```

游戏作者编写一份 `GameDefinition`。浏览器和 Worker 分别装配它：

```ts
// 客户端
const game = createGameRuntime(gameDefinition, {
  role: 'client',
  playerId: parti.playerId!,
});
game.use(createPartiSyncPlugin(parti));
```

```ts
// worker/index.ts
import { createFlowRoom } from '@parti/flow/worker';
import { gameDefinition } from '../game/definition';

export default createFlowRoom(gameDefinition);
```

Worker 协议没有改变；`createFlowRoom()` 只是自动生成协议要求的 `RoomDefinition`。

---

# 3. 总体架构

```text
输入 / 碰撞 / UI
       ↓
game.action(type, payload)
       ↓
ActionRegistry
       ├─ 本地 reducer（预测模式）
       └─ createPartiSyncPlugin
                ↓
          Parti action 协议
                ↓
          createFlowRoom
                ↓
       validate → authority reducer
                ↓
       权威 Action + Room state
                ↓
客户端回放 / snapshot 收敛
```

客户端本地世界包括：

- `StateStore`：可序列化的游戏事实；
- `World`：客户端 ECS 风格实体和组件；
- `EventBus`：表现事件；
- `GameSystem[]`：每帧逻辑；
- `GamePlugin[]`：同步等旁路能力。

---

# 4. 最重要的抽象：Action / State / Event

## 4.1 Action：改变游戏的行为

同构游戏优先在 `GameDefinition.actions` 中声明 Action：

```ts
type HitPayload = {
  hitId: string;
  targetId: string;
  damage: number;
};

export const gameDefinition = defineGame<GameState>({
  initialState,
  actions: {
    'combat.hit': {
      sync: { mode: 'hostRelay' },

      validate(ctx, payload: HitPayload) {
        const target = ctx.state.enemies[payload.targetId];
        if (!target) return reject('target-not-found');
        if (!Number.isFinite(payload.damage)) return reject('invalid-damage');

        return accept({
          ...payload,
          damage: Math.max(1, Math.min(10, payload.damage)),
        });
      },

      reduce(ctx, payload: HitPayload) {
        const target = ctx.state.enemies[payload.targetId];
        if (!target) return;
        target.hp = Math.max(0, target.hp - payload.damage);
        ctx.emit('fx.hit', payload);
      },
    },
  },
});
```

实际规则：

- `validate` 只在 authority runtime 执行；
- `validate` 必须返回 `accept(payload)` 或 `reject(reason)`；
- `accept` 可以返回规范化后的新 payload；
- `reduce` 是共享状态规则；
- payload 必须可被 `JSON.stringify()`；
- action ID 由客户端生成，并随 `__partiflow` envelope 进入 Worker。

## 4.2 State：当前世界事实

`GameDefinition.initialState()` 返回权威 state 的初始结构：

```ts
type GameState = {
  phase: 'lobby' | 'running' | 'gameover';
  players: Record<string, PlayerState>;
  enemies: Record<string, EnemyState>;
  score: number;
};

const initialState = (): GameState => ({
  phase: 'lobby',
  players: {},
  enemies: {},
  score: 0,
});
```

客户端可通过以下方式读取：

```ts
const state = game.state.get<GameState>('');
const hp = game.state.get<number>('players.p1.hp');
```

Worker reducer 中的 `ctx.state` 是 RoomEngine 持有的权威对象，可以直接修改。

## 4.3 Event：本地表现事件

Reducer 使用 `ctx.emit()` 派生 Event：

```ts
reduce(ctx, payload) {
  ctx.state.score += 1;
  ctx.emit('audio.play', { id: 'score' });
}
```

客户端订阅：

```ts
const dispose = game.events.on<{ id: string }>('audio.play', ({ id }) => {
  audio.play(id);
});
```

当前 Worker adapter 中，authority `ctx.emit()` 本身不会额外广播。Event 依靠权威 action 在客户端回放 reducer 时派生，避免“Event 广播一次 + Action 回放再派生一次”的重复表现。

因此不要依赖 lifecycle hook 中的 `ctx.emit()` 产生客户端表现；lifecycle 需要表现时，应 dispatch 一个 Action。

---

# 5. 当前核心接口

## 5.1 GameDefinition

真实接口：

```ts
interface GameDefinition<State> {
  meta?: {
    name?: string;
    minPlayers?: number;
    maxPlayers?: number;
  };

  initialState(): State;

  actions: Record<string, FlowActionDefinition<State, any>>;

  state?: Record<
    string,
    StateSyncConfig & { write?: 'owner' }
  >;

  systems?: FlowSystemDefinition<State>[];
  lifecycle?: FlowLifecycle<State>;
}
```

`defineGame()` 只返回传入的定义，用于类型推断：

```ts
const gameDefinition = defineGame<GameState>({ ... });
```

## 5.2 GameRuntime

```ts
interface GameRuntime {
  readonly playerId: string;
  readonly isHost: boolean;
  readonly world: World;
  readonly actions: ActionRegistry;
  readonly state: StateStore;
  readonly events: EventBus;
  readonly systems: readonly GameSystem[];
  readonly plugins: readonly GamePlugin[];

  action<T>(type: string, payload?: T): GameAction<T>;
  update(dt: number): void;
  use(plugin: GamePlugin): void;
  addSystem(system: GameSystem): void;
  dispose(): void;
}
```

推荐使用同构重载：

```ts
createGameRuntime(gameDefinition, {
  role: 'client',
  playerId,
  stateAdapter,
  now,
  players,
  host,
});
```

也存在不带 `GameDefinition` 的底层重载：

```ts
createGameRuntime({ playerId });
```

新游戏通常不应使用底层重载手工重复注册 actions。

## 5.3 World / Entity / Component

真实接口：

```ts
interface World {
  spawn(options: {
    id?: string;
    type?: string;
    components?: Record<string, unknown>;
  }): string;

  destroy(id: string): void;
  has(id: string): boolean;
  getComponent<T>(id: string, name: string): T | undefined;
  setComponent<T>(id: string, name: string, value: T): void;
  patchComponent<T extends object>(
    id: string,
    name: string,
    patch: Partial<T>,
  ): void;
  entitiesWith(...components: string[]): string[];
}
```

示例：

```ts
game.world.spawn({
  id: 'p1:shot:1',
  type: 'projectile',
  components: {
    Transform: { x: 100, y: 200 },
    Velocity: { x: 0, y: 900 },
    Owner: 'p1',
    Lifetime: 1.5,
  },
});
```

注意：当前 `World` 是客户端内存结构，不会自动序列化到 Worker。需要权威收敛的事实应放在 `GameState`，再通过 `StateAdapter` 映射到 World。

## 5.4 FlowReducerContext

```ts
interface FlowReducerContext<State> {
  state: State;
  role: 'client' | 'authority';
  actor: FlowPlayer;
  players: FlowPlayer[];
  host: FlowPlayer;
  now(): number;
  random(): number;
  timers: FlowTimerService;
  emit<T>(type: string, payload: T): void;
  dispatch<T>(type: string, payload?: T, actorId?: string): void;
  kick(playerId: string, reason?: string): void;
}
```

重要边界：

- 客户端 `timers.dispatch/clear` 当前是 no-op；
- 客户端 `kick` 当前是 no-op；
- authority timer 和 kick 映射到 `RoomContext`；
- 客户端 `players/host` 来自 runtime options，未提供时只有本地玩家占位；
- 远端 action actor 未在 players 中时，会创建只含 ID 的临时 player；
- 客户端 `random()` 是 `Math.random()`，authority 使用 `RoomContext.random()`。

不要在需要客户端与 Worker 完全一致的预测 reducer 中直接取随机数。应由 authority `validate` 把随机结果写入规范化 payload，或把确定性 seed 放入 state。

## 5.5 GameAction

```ts
interface GameAction<T = unknown> {
  id: string;
  type: string;
  payload: T;
  from: string;
  seq: number;
  origin: 'local' | 'remote' | 'host' | 'replay';
  createdAt: number;
  roomId?: string;
}
```

ActionRegistry 会：

- 自动生成 `${playerId}:${seq}` ID；
- 拒绝未知 action；
- 检查 payload 能否 JSON 序列化；
- 按 ID 去重；
- 对本地 `hostAuthoritative` action 延迟 reducer；
- 收到同 ID 的 host 确认后执行一次被延迟的 reducer。

## 5.6 StateStore

```ts
interface StateStore {
  get<T>(path: string): T | undefined;
  set<T>(path: string, value: T): void;
  patch(patch: StatePatch): boolean;
  define(pattern: string, config: StateSyncConfig): void;
  config(path: string): StateSyncConfig | undefined;
  onChange(listener: (patch: StatePatch) => void): () => void;
  snapshot(value: unknown, path?: string): void;
  clear(): void;
}
```

路径通过 `.` 分割，规则支持单段 `*`：

```ts
game.state.get('players.p1.hp');
```

完整 Worker state 到达时，同步插件调用：

```ts
game.state.snapshot(state);
```

完整 snapshot 会替换客户端内部 state，并向 `StateAdapter.set('', state, ...)` 写入根路径。

## 5.7 EventBus

```ts
game.events.on('fx.hit', handler); // 返回 disposer
game.events.emit('fx.hit', payload);
game.events.clear();
```

`dispose()` 会清理全部 EventBus handlers、插件和 systems。

---

# 6. 同步策略设计

## 6.1 Action 同步模式

### localOnly

行为：

- 客户端立即执行 reducer；
- `createPartiSyncPlugin` 不发送；
- Worker 即使收到也会拒绝为 `local-only`。

适合本地镜头、调试和纯 UI：

```ts
'camera.shake': {
  sync: { mode: 'localOnly' },
  reduce(ctx, payload) {
    ctx.emit('camera.shake', payload);
  },
}
```

### optimisticBroadcast

行为：

- 发起客户端立即执行 reducer；
- Worker 执行 `validate`，但不执行 authority reducer；
- Worker 广播规范化后的权威 action；
- 其他客户端回放 reducer；
- 发起客户端按相同 ID 去重，不重复回放。

适合射击、表情、短暂技能表现。

不要用它承载必须写入权威 state 的规则，因为 Worker 不执行 reducer。

### hostRelay

行为：

- 发起客户端立即执行 reducer；
- Worker `validate + reduce`；
- Worker 广播权威 action；
- 其他客户端回放 reducer；
- 发起客户端已经执行过，通过 ID 去重；
- RoomEngine 随后发送完整 state 纠正预测误差。

适合命中、扣血、拾取、死亡结果：

```ts
'loot.claim': {
  sync: { mode: 'hostRelay' },
  validate(ctx, payload) { ... },
  reduce(ctx, payload) { ... },
}
```

### hostAuthoritative

行为：

- 发起客户端只登记 action，不执行 reducer；
- Worker `validate + reduce`；
- Worker 使用相同 action ID 广播确认；
- 发起客户端收到确认后执行一次延迟 reducer；
- 所有客户端再由完整 state 收敛。

适合开局、结算、刷怪、Boss tick、复活：

```ts
'game.start': {
  sync: { mode: 'hostAuthoritative' },
  validate(ctx) {
    return ctx.actor.id === ctx.host.id
      ? accept(null)
      : reject('host-only');
  },
  reduce(ctx) {
    ctx.state.phase = 'running';
  },
}
```

`reliable` 和 `local` 字段目前存在于类型中，但当前 Parti 同步插件没有针对它们实现额外行为。不要依赖这两个字段改变传输语义。

## 6.2 State 同步模式

```ts
type StateSyncMode =
  | 'ownerInterval'
  | 'hostInterval'
  | 'manualSnapshot'
  | 'presence';
```

真实客户端行为：

- `hostInterval` patch 不从客户端发送；
- 其他三种模式通过 `partiflow:state` action 发送；
- `intervalMs` 是按 path 的 trailing throttle；
- Worker 只接受 GameDefinition 中声明 `write: 'owner'` 的路径；
- Worker 校验第一个 `*` 对应的路径段必须等于发送玩家 ID。

示例：

```ts
state: {
  'players.*.cursor': {
    sync: {
      mode: 'ownerInterval',
      intervalMs: 80,
      remoteApply: 'smooth',
    },
    write: 'owner',
  },
}
```

然后客户端：

```ts
game.state.set(`players.${game.playerId}.cursor`, cursor);
```

当前限制：

- `ownerInterval/manualSnapshot/presence` 目前走同一种 patch 通道，仅 interval 配置不同；
- `hostInterval` 不会按配置自动启动 Worker 定时广播；权威 state 由 RoomEngine 在 action、lifecycle、timer 后发送完整 snapshot；
- `smooth` 不包含内置插值算法，只作为 `StateAdapter` 的 `remoteApply` 参数；
- 没有 `write: 'owner'` 的客户端 patch 会被 Worker 拒绝。

---

# 7. 一致性等级

推荐映射：

| 等级 | 内容 | 当前 PartiFlow 策略 |
|---|---|---|
| 0 | 粒子、音效、镜头 | Event 或 `localOnly` |
| 1 | 光标、姿态、方向 | owner state patch，或 `hostRelay` pose action |
| 2 | 射击、表情、施法 | `optimisticBroadcast` |
| 3 | 血量、拾取、死亡 | `hostRelay` + Room state snapshot |
| 4 | 开始、结算、刷怪、Boss tick | `hostAuthoritative` |

如果 action 会改变必须存在于 Worker 的权威 state，不要选择 `optimisticBroadcast`。

---

# 8. Plugin 机制

## 8.1 createPartiSyncPlugin

```ts
game.use(createPartiSyncPlugin(parti));
```

它实际负责：

- 监听本地 action，并以 `{ __partiflow: action }` 发送；
- 接收 `partiflow:action` 并回放；
- 发送允许客户端写入的 state patch；
- 接收完整 state snapshot；
- 将 `partiflow:event` 转入 EventBus；
- 将 `partiflow:reject` 转入 EventBus；
- dispose 时取消所有 Parti 订阅和 throttle timer。

可以监听拒绝：

```ts
game.events.on('partiflow:reject', (rejection) => {
  console.warn('Action rejected', rejection);
});
```

## 8.2 Plugin 不负责的内容

同步插件不会：

- 计算伤害；
- 判断碰撞；
- 执行元素反应；
- 插值远端位置；
- 直接操作渲染器；
- 自动回滚 World 中的临时表现实体。

这些能力应由 reducer、system、StateAdapter 和 Event consumer 完成。

---

# 9. StateAdapter：把 Snapshot 映射到游戏对象

```ts
const stateAdapter: StateAdapter = {
  get() {
    return undefined;
  },

  set(path, value, options) {
    if (path !== '') return;

    const state = value as GameState;
    for (const player of Object.values(state.players)) {
      if (!game.world.has(player.id)) {
        game.world.spawn({
          id: player.id,
          type: 'player',
          components: {
            Transform: { x: player.x, y: player.y },
            PlayerState: player,
          },
        });
      } else if (options?.remoteApply === 'smooth') {
        game.world.setComponent(player.id, 'RemoteTarget', {
          x: player.x,
          y: player.y,
        });
      } else {
        game.world.patchComponent(player.id, 'Transform', {
          x: player.x,
          y: player.y,
        });
      }
    }
  },
};
```

创建 runtime 时会立即把 `initialState()` snapshot 写入 adapter。若 adapter 闭包引用 runtime，需要像 Skyward 一样先使用可空变量，避免 runtime 尚未赋值：

```ts
let runtime: GameRuntime | null = null;
const adapter = { set() { if (runtime) { ... } } };
const game = runtime = createGameRuntime(definition, options);
```

---

# 10. Systems：客户端帧循环与 Worker 定时循环

GameDefinition system：

```ts
systems: [
  {
    runOn: 'client',
    update(ctx, dt) {
      // 客户端移动、插值、投射物表现
    },
  },
  {
    runOn: 'authority',
    intervalMs: 200,
    update(ctx, dt) {
      // 权威周期逻辑
    },
  },
]
```

执行规则：

- `client`：由调用方每帧执行 `game.update(dt)`；
- `authority`：`createFlowRoom()` 使用 `RoomContext.setTimer` 周期执行；
- `both`：两侧都执行；
- authority 默认间隔为 50ms；
- client system 的 `intervalMs` 当前不会限频，仍随每次 `game.update(dt)` 执行。

对于重要权威变更，更推荐 timer dispatch 内部 Action：

```ts
ctx.timers.dispatch(
  'boss:tick',
  200,
  'internal.bossTick',
);
```

这样所有状态改变仍经过 Action reducer。

---

# 11. Render / FX 与同步解耦

渲染层只读取 World 和订阅 Event：

```ts
game.events.on<ShotEvent>('fx.shot', (shot) => {
  if (!game.world.has(shot.shotId)) {
    game.world.spawn({
      id: shot.shotId,
      type: 'projectile',
      components: {
        Transform: { x: shot.x, y: shot.y },
        Lifetime: 1.6,
      },
    });
  }
});
```

Render loop：

```ts
for (const id of game.world.entitiesWith('Transform', 'Renderable')) {
  const transform = game.world.getComponent<Transform>(id, 'Transform');
  const renderable = game.world.getComponent<Renderable>(id, 'Renderable');
  renderer.draw(renderable!, transform!);
}
```

不要在 renderer 中订阅 `parti.onEvent()`；网络入口应集中在 `createPartiSyncPlugin()`。

---

# 12. 完整示例：多人元素释放游戏

## 12.1 游戏状态和实体

```ts
type Element = 'fire' | 'water' | 'lightning';

type ElementGameState = {
  phase: 'lobby' | 'running';
  players: Record<string, {
    id: string;
    hp: number;
    x: number;
    y: number;
  }>;
  monsters: Record<string, {
    id: string;
    hp: number;
    element?: Element;
  }>;
};
```

客户端 World 可以额外持有：

```text
Transform
Velocity
Renderable
Collider
RemoteTarget
Lifetime
```

## 12.2 GameDefinition

```ts
export const elementGame = defineGame<ElementGameState>({
  meta: {
    name: 'Element Party',
    minPlayers: 1,
    maxPlayers: 4,
  },

  initialState: () => ({
    phase: 'lobby',
    players: {},
    monsters: {},
  }),

  lifecycle: {
    join(ctx, player) {
      ctx.state.players[player.id] = {
        id: player.id,
        hp: 100,
        x: 0,
        y: 0,
      };
    },

    leave(ctx, player) {
      delete ctx.state.players[player.id];
    },
  },

  actions: {
    'player.castSpell': {
      sync: { mode: 'optimisticBroadcast' },

      validate(ctx, payload: CastPayload) {
        if (!ctx.state.players[ctx.actor.id]) {
          return reject('unknown-player');
        }
        return accept(payload);
      },

      reduce(ctx, payload: CastPayload) {
        ctx.emit('spell.cast', {
          ...payload,
          playerId: ctx.actor.id,
        });
      },
    },

    'combat.hit': {
      sync: { mode: 'hostRelay' },

      validate(ctx, payload: HitPayload) {
        const monster = ctx.state.monsters[payload.targetId];
        if (!monster) return reject('unknown-target');
        return accept({
          ...payload,
          damage: Math.max(1, Math.min(50, payload.damage)),
        });
      },

      reduce(ctx, payload: HitPayload) {
        const monster = ctx.state.monsters[payload.targetId];
        if (!monster) return;
        monster.hp = Math.max(0, monster.hp - payload.damage);
        ctx.emit('fx.hit', payload);
      },
    },
  },
});
```

---

# 13. 玩家释放技能的完整链路

## 13.1 输入层

```ts
function castSpell(element: Element, direction: Vec2) {
  const seq = ++spellSequence;
  game.action('player.castSpell', {
    spellId: `${game.playerId}:spell:${seq}`,
    element,
    direction,
  });
}
```

## 13.2 Action 执行

若为 `optimisticBroadcast`：

```text
本地 reduce
  → EventBus: spell.cast
  → 本地生成投射物
  → Worker validate / normalize
  → 广播同一 Action
  → 远端 reduce
  → 远端生成投射物
```

## 13.3 投射物构建

```ts
game.events.on<SpellCast>('spell.cast', (spell) => {
  game.world.spawn({
    id: spell.spellId,
    type: 'spell',
    components: {
      Transform: spell.position,
      Velocity: scale(spell.direction, 900),
      Element: spell.element,
      Owner: spell.playerId,
      Lifetime: 2,
    },
  });
});
```

## 13.4 稳定 ID

网络相关实体必须使用 payload 中的稳定 ID：

```ts
const spellId = `${playerId}:spell:${sequence}`;
```

不要依赖 `World.spawn()` 的自动 `entity:n` ID 在多个客户端一致。

---

# 14. 法球飞行、碰撞与命中

## 14.1 MovementSystem

```ts
game.addSystem({
  update(game, dt) {
    for (const id of game.world.entitiesWith('Transform', 'Velocity')) {
      const transform = game.world.getComponent<Transform>(id, 'Transform')!;
      const velocity = game.world.getComponent<Velocity>(id, 'Velocity')!;
      game.world.setComponent(id, 'Transform', {
        x: transform.x + velocity.x * dt,
        y: transform.y + velocity.y * dt,
      });
    }
  },
});
```

## 14.2 CollisionSystem

碰撞只负责检测，并 dispatch 语义 Action：

```ts
if (intersects(projectile, monster)) {
  game.action('combat.hit', {
    hitId: `${projectileId}:${monsterId}`,
    targetId: monsterId,
    damage: projectile.damage,
  });
}
```

## 14.3 combat.hit

使用 `hostRelay`：本地立即反馈，Worker validate 后执行同一个 reducer，随后完整 state 收敛。

validate 中应检查：

- actor 是否存在且存活；
- hitId/sequence 是否重复；
- target 是否存在；
- damage 是否为有限数字；
- damage 是否需要裁剪。

---

# 15. 元素反应如何接入

元素反应属于状态规则，应放在 reducer 或 reducer 调用的纯函数中：

```ts
reduce(ctx, hit) {
  const target = ctx.state.monsters[hit.targetId];
  const reaction = resolveReaction(target.element, hit.element);
  applyReaction(target, reaction);
  ctx.emit('fx.reaction', {
    targetId: target.id,
    reaction,
  });
}
```

不要在客户端 FX handler 中修改权威 state。

---

# 16. 召唤墙与障碍物

创建权威实体时，把实体描述写入 state：

```ts
'obstacle.spawn': {
  sync: { mode: 'hostRelay' },
  validate(ctx, payload) {
    return accept({
      ...payload,
      id: `${ctx.actor.id}:wall:${payload.sequence}`,
    });
  },
  reduce(ctx, payload) {
    ctx.state.obstacles[payload.id] = {
      id: payload.id,
      ownerId: ctx.actor.id,
      hp: 100,
      x: payload.x,
      y: payload.y,
    };
  },
}
```

StateAdapter 根据 snapshot 创建或更新对应 World entity。

---

# 17. 远端玩家移动

当前实现有两种可用方式。

方式 A：owner state patch：

```ts
state: {
  'players.*.position': {
    sync: {
      mode: 'ownerInterval',
      intervalMs: 80,
      remoteApply: 'smooth',
    },
    write: 'owner',
  },
}
```

方式 B：姿态 Action：

```ts
'player.pose': {
  sync: { mode: 'hostRelay' },
  validate(ctx, pose) { ... },
  reduce(ctx, pose) {
    ctx.state.players[ctx.actor.id].position = pose.position;
    ctx.emit('player.pose', { playerId: ctx.actor.id, ...pose });
  },
}
```

Skyward 使用方式 B，并在客户端维护独立 `RemotePose` 插值结构。

`remoteApply: 'smooth'` 只是标签；插值仍需游戏自己实现。

---

# 18. Worker 快照兜底

当前不需要游戏手写 HostSnapshotPlugin。

执行链：

```text
RoomEngine action / lifecycle / timer
  ↓
createFlowRoom 修改 ctx.state
  ↓
RoomEngine 自动 onState(state)
  ↓
Parti Client SDK onState
  ↓
createPartiSyncPlugin
  ↓
StateStore.snapshot(state)
  ↓
StateAdapter.set('', state)
```

注意：snapshot 是完整对象替换，不是增量 diff。

---

# 19. 复杂战斗流程

推荐把复杂流程拆为多个语义 Action，而不是在网络层组合：

```text
player.castSpell (optimisticBroadcast)
  ↓ 本地/远端生成投射物
combat.hit (hostRelay)
  ↓ 共享 reducer 修改 hp / 元素
monster.defeat (ctx.dispatch 或 reducer 内纯函数)
  ↓ 掉落与分数
game.finish (hostAuthoritative)
  ↓ 权威结算
```

`ctx.dispatch()` 在客户端会调用本地 `game.action()`；在 authority 会直接执行内部 action 并广播。为避免客户端额外发送仅供 Worker 使用的内部 action，通常通过 `ctx.timers.dispatch()` 触发 authority-only action，或在同一个共享 reducer 中调用纯函数。

---

# 20. 推荐代码组织

```text
src/
  game/
    contracts.ts       # State、payload、组件类型
    definition.ts      # 唯一 GameDefinition
    rules/             # reducer 调用的纯规则
    generation/        # 确定性内容生成

  runtime/
    createClient.ts    # createGameRuntime + sync plugin
    stateAdapter.ts    # snapshot → World
    systems/           # client systems

  scenes/
    GameScene.ts       # 输入、渲染、设备能力

  worker/
    index.ts           # 仅 createFlowRoom(definition)
```

Worker 入口应保持：

```ts
import { createFlowRoom } from '@parti/flow/worker';
import { gameDefinition } from '../game/definition';

export default createFlowRoom(gameDefinition);
```

---

# 21. 推荐开发流程

## 第一步：定义可序列化 State

先确定哪些事实必须由 Worker 收敛：阶段、玩家、血量、实体存活、分数、Boss 状态。

## 第二步：建立 GameDefinition

实现 `initialState`、`lifecycle` 和最小 action 集合。不要先在 Scene 中直接写网络调用。

## 第三步：给每个 Action 选择策略

- 纯表现：`localOnly`；
- 远端必须看到、无权威 state：`optimisticBroadcast`；
- 本地预测、最终收敛：`hostRelay`；
- 必须先裁决：`hostAuthoritative`。

## 第四步：拆分 validate / reduce

- validate：权限、格式、去重、裁剪、规范化；
- reduce：唯一游戏规则；
- Event：由 reduce 派生表现。

## 第五步：接入客户端 Runtime

```ts
const game = createGameRuntime(definition, {
  role: 'client',
  playerId: parti.playerId!,
  stateAdapter,
});
game.use(createPartiSyncPlugin(parti));
```

## 第六步：接入游戏循环

```ts
function update(dt: number) {
  game.update(dt);
}
```

## 第七步：接入 Worker

使用一行 `createFlowRoom(definition)`，不要再写第二份 action map。

## 第八步：测试两侧一致性

至少覆盖：

- 本地预测 reducer；
- validate 接受、拒绝、规范化；
- authority reducer；
- action ID 去重；
- hostAuthoritative 延迟执行；
- timer action；
- snapshot → StateAdapter；
- worker bundle 可被 `loadRoomDefinition()` 加载。

---

# 22. 设计约束

## 22.1 权威状态改变必须走 reducer

Scene 不应直接改变 `GameState`。客户端临时 Transform、粒子和插值可以只改 World。

## 22.2 Payload 必须可序列化

不要传递：函数、DOM、Canvas、BigInt、Symbol、循环引用。

当前检查基于 `JSON.stringify()`，它不会严格拒绝所有 class、Map 或 Set，因此开发者仍应只使用普通对象、数组和 JSON 标量。

## 22.3 网络实体必须有稳定 ID

```ts
`${playerId}:spell:${sequence}`
`${playerId}:hit:${sequence}`
`${playerId}:wall:${sequence}`
```

## 22.4 validate 不能承担第二份规则

validate 只做：

- 身份和阶段权限；
- 输入格式；
- 去重；
- 数值裁剪；
- 把随机/权威结果规范化进 payload。

血量、反应、死亡、分数等规则必须只存在于 reducer 或 reducer 调用的纯函数。

## 22.5 Timer 只 dispatch Action

```ts
ctx.timers.dispatch('respawn:p1', 4000, 'internal.respawn', {
  playerId: 'p1',
});
```

客户端 timer 当前是 no-op；authority timer 由 Worker RoomContext 执行。

## 22.6 不要依赖客户端 authority 信息完整

客户端 `players` 和 `host` options 若未主动维护，可能只有本地占位信息。权限判断必须放在 validate，不要只在客户端 reducer 判断。

## 22.7 生命周期只在 authority 执行

`create/restore/join/reconnect/leave/ready` 由 Worker 调用。客户端通过 snapshot 观察结果。

---

# 23. 最终执行模型

```text
客户端输入
  ↓
game.action
  ↓
ActionRegistry 生成稳定 action ID
  ↓
按策略立即 reducer 或延迟
  ↓
EventBus / World / 本地表现

同时：

createPartiSyncPlugin
  ↓
parti.action(type, { __partiflow: action })
  ↓
固定 Worker 协议
  ↓
createFlowRoom
  ↓
validate
  ↓
reject 或规范化 payload
  ↓
按策略 relay / authority reducer
  ↓
partiflow:action + RoomEngine 完整 state
  ↓
客户端回放 / 去重 / snapshot 收敛
```

---

# 24. 新游戏最小模板

```ts
// game/definition.ts
import { accept, defineGame, reject } from '@parti/flow';

type State = {
  players: Record<string, { id: string; score: number }>;
};

export const gameDefinition = defineGame<State>({
  meta: { name: 'My Game', minPlayers: 1, maxPlayers: 4 },
  initialState: () => ({ players: {} }),

  lifecycle: {
    join(ctx, player) {
      ctx.state.players[player.id] = { id: player.id, score: 0 };
    },
    leave(ctx, player) {
      delete ctx.state.players[player.id];
    },
  },

  actions: {
    'score.add': {
      sync: { mode: 'hostRelay' },
      validate(ctx, payload: { amount: number }) {
        if (!ctx.state.players[ctx.actor.id]) {
          return reject('unknown-player');
        }
        return accept({
          amount: Math.max(0, Math.min(10, payload.amount)),
        });
      },
      reduce(ctx, payload) {
        ctx.state.players[ctx.actor.id].score += payload.amount;
        ctx.emit('score.changed', {
          playerId: ctx.actor.id,
          amount: payload.amount,
        });
      },
    },
  },
});
```

```ts
// runtime/createClient.ts
import { createGameRuntime, createPartiSyncPlugin } from '@parti/flow';
import { gameDefinition } from '../game/definition';

export function createClientGame() {
  const game = createGameRuntime(gameDefinition, {
    role: 'client',
    playerId: parti.playerId!,
  });
  game.use(createPartiSyncPlugin(parti));
  return game;
}
```

```ts
// worker/index.ts
import { createFlowRoom } from '@parti/flow/worker';
import { gameDefinition } from '../game/definition';

export default createFlowRoom(gameDefinition);
```

---

# 25. 一句话总结

PartiFlow 当前真正提供的是：

```text
用一份 GameDefinition 描述游戏，
用 validate 保护 Worker 边界，
用共享 reducer 同时完成本地预测与权威执行，
用 RoomEngine snapshot 让关键状态最终收敛。
```
