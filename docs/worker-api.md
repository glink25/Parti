# Room Worker API（房间逻辑）

`room.worker.js` 是房间的**权威逻辑**，运行在房主浏览器的 Web Worker 里。
它持有唯一一份权威 `state`，处理玩家提交的 action，并通过修改 `state`、广播事件
来驱动游戏。本篇是它的完整 API 参考。

源码：`packages/worker-sdk/src/defineRoom.ts`、`packages/worker-sdk/src/RoomEngine.ts`。

## 1. 骨架

```js
import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  meta: { name: '我的房间', minPlayers: 2, maxPlayers: 4 },

  initialState() {
    return { /* 初始权威 state */ };
  },

  onJoin(ctx, player) { /* 有人加入 */ },
  onLeave(ctx, player) { /* 有人离开 */ },

  actions: {
    myAction(ctx, { player, payload }) { /* 处理一次玩家意图 */ },
  },
});
```

`room.worker.js` **必须** `export default defineRoom({...})`，且 `initialState`
必须是一个函数，否则加载会报错。

## 2. `defineRoom(definition)`

`definition` 的字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `initialState` | `(ctx) => State` | ✅ | 返回房间初始状态。`ctx` 为 `{ meta?, manifest? }`。 |
| `meta` | `{ name?, minPlayers?, maxPlayers? }` | | 房间元信息。 |
| `onCreate` | `(ctx) => void` | | 房间首次创建、`initialState` 之后触发。 |
| `onRestore` | `(ctx) => void` | | 房间**从持久化快照恢复**（房主刷新后）时触发，**替代** `onCreate`。 |
| `onJoin` | `(ctx, player) => void` | | 有玩家加入时触发。 |
| `onLeave` | `(ctx, player) => void` | | 有玩家离开时触发（在玩家被移出列表之前）。 |
| `onReady` | `(ctx, player) => void` | | 玩家调用 `parti.ready()` 时触发。 |
| `onReconnect` | `(ctx, player) => void` | | 某玩家**断线后重连回归**（复用原身份）时触发，**替代** `onJoin`。 |
| `actions` | `Record<string, ActionHandler>` | | 玩家可提交的 action，键为 action 名。 |

### 生命周期触发时机

```txt
房间创建：      initialState() → onCreate()
房主刷新恢复：  （跳过 initialState）→ onRestore()   ← 用持久化快照水合
玩家加入：      onJoin(player)
玩家点 ready：  onReady(player)
玩家断线重连：  onReconnect(player)                 ← 不是 onJoin
玩家离开：      onLeave(player)
```

- **`onRestore` / `onReconnect` 默认无需实现**——重连与现场恢复是 Runtime 内置能力，
  你什么都不写也能获得「房主刷新不丢状态、玩家断线重连回原座位」。只有当你需要在
  恢复 / 重连时做额外处理（比如重置某个计时器）才实现它们。详见仓库 README 的
  「房间重连与持久化」小节。
- `onCreate` 与 `onRestore` 二选一触发：全新房间走 `onCreate`，快照恢复走 `onRestore`。

## 3. `RoomContext`（`ctx`）

每个钩子和 action 的第一个参数都是 `ctx`：

```ts
interface RoomContext<State> {
  state: State;            // 可变的权威状态——直接改它
  players: RoomPlayer[];   // 当前在场玩家列表
  host: RoomPlayer;        // 房主

  now(): number;           // 当前时间戳（Date.now()）
  random(): number;        // [0,1) 随机数

  broadcast(event: string, payload?: unknown): void;       // 广播事件给所有人
  send(playerId: string, event: string, payload?: unknown): void;  // 私密发给一人
  kick(playerId: string, reason?: string): void;           // 踢人
  log(...args: unknown[]): void;                            // 打到 DevTools

  setTimer(name: string, ms: number, callback: () => void): void;  // 具名定时器
  clearTimer(name: string): void;
}
```

### `ctx.state`

权威状态。**直接修改它即可**（`ctx.state.count += 1`、`ctx.state.players[id] = {...}`）。
每个输入（join/leave/ready/action/timer 回调）处理完后，Runtime 会自动把最新 state
作为快照广播给所有玩家。你**不需要**手动触发同步。

> state 会被序列化广播给所有玩家，因此**不要把秘密放进 state**（答案、底牌、身份）。
> 隐藏信息的做法见下文「陷阱与约束 §2」。

### `broadcast` vs `send`

- `ctx.broadcast(event, payload)`——给**所有**玩家发一个一次性事件。用于「开局了」
  「有人猜错了」这类瞬时通知。UI 侧用 `parti.onEvent(event, handler)` 接收。
- `ctx.send(playerId, event, payload)`——只发给**某一个**玩家。用于私密信息：告诉某人
  他的身份 / 手牌 / 座位。

> **事件 ≠ 状态**。事件是「发生了一件事」的一次性通知，不会被新加入的玩家补收；
> 持久的东西要放进 `state`。多数房间靠 `state` 同步就够了，事件只是锦上添花。

### `setTimer` / `clearTimer`

具名定时器，用于回合倒计时等。`setTimer(name, ms, cb)` 同名会先清掉旧的再设；
回调里同样直接改 `ctx.state`，回调执行完也会自动广播。

```js
ctx.setTimer('round', 30000, () => {
  ctx.state.phase = 'finished';
  ctx.broadcast('game:timeout', {});
});
// 提前结束：
ctx.clearTimer('round');
```

### `kick`

`ctx.kick(playerId, reason?)`——把玩家移出房间。

## 4. Action Handler

```ts
type ActionHandler<State> = (
  ctx: RoomContext<State>,
  event: {
    player: RoomPlayer;   // 提交这个 action 的玩家
    payload: any;         // parti.action(name, payload) 里传的 payload（省略时为 null）
    actionId: string;     // 该次提交的唯一 id（一般用不到）
  },
) => void;   // ⚠️ 仅同步，不支持 async
```

- action 名由你自定义（`mark`、`guess`、`vote`…），UI 侧用 `parti.action('mark', payload)` 触发。
- **handler 必须是同步的**，目前不支持 `async`。需要延时用 `ctx.setTimer`。
- 提交了一个**未定义**的 action 名，Runtime 会报一个运行时错误而非崩溃。
- handler 里务必做**校验**（轮到谁了、操作是否合法），因为玩家提交的 `payload` 不可信。
  不合法时直接 `return` 即可（什么都不改，就什么都不会广播）。

## 5. `RoomPlayer`

```ts
interface RoomPlayer {
  id: string;
  name: string;
  role: 'host' | 'player' | 'spectator';
}
```

> 房主**自己也是一名玩家**——第一个触发 `onJoin` 的通常就是房主。写座位分配逻辑时
> 不要假设第一个加入的是「别人」。

## 6. 陷阱与约束（务必阅读）

房间 Worker 由一个轻量加载器（`packages/worker-sdk/src/loader.ts`）动态求值，
不是真正的打包流程，因此有几条硬性约束：

### 1) 只能 `import { defineRoom }`，不能 import 任何第三方包

加载器会**剥离所有 `@parti/*` 以及文件名含 `worker` 的 import 语句**，然后把
`defineRoom` 作为参数注入。所以：

```js
import { defineRoom } from '@parti/worker-sdk'; // ✅ 唯一允许（会被剥离后注入）

import _ from 'lodash';            // ❌ 不会被安装，剥不掉的话会运行时报错
import { foo } from './utils.js';  // ❌ 不支持相对 import / 多文件
```

所有逻辑写在这**一个文件**里，只用标准 JS（`Math`、`JSON`、`Object`、`Array`…）。

### 2) 隐藏状态：用模块顶层变量，别放进 `state`

`state` 会被广播给所有玩家。不想让玩家看到的权威数据（谜底、底牌、狼人身份）放在
`initialState` **之外的模块顶层变量**里——它在 Worker 内存里持续存在，但永远不进入
快照：

```js
import { defineRoom } from '@parti/worker-sdk';

let secretAnswer = null; // ← 隐藏状态，不会被同步给玩家

export default defineRoom({
  initialState() { return { phase: 'waiting', hint: null }; },
  actions: {
    start(ctx) {
      secretAnswer = 'parti';      // 只存在房主 Worker 内存
      ctx.state.hint = '本平台名'; // 只把提示放进 state
    },
    guess(ctx, { payload }) {
      if (payload.text === secretAnswer) { /* 命中 */ }
    },
  },
});
```

### 3) 直接改 `state`，不要手动同步

不要尝试自己发 snapshot / patch / 维护 seq。改完 `ctx.state` 就交给 Runtime。

### 4) 自定义事件命名

`sys:` 和 `state:` 是协议保留前缀；`__error` 是内部保留事件名。自定义事件请用
`game:` 或自己的命名空间（如 `counter:incremented`、`guess:wrong`），避免冲突。

## 7. 完整示例

把以上 API 串起来的完整游戏见 [示例：井字棋](./example-tic-tac-toe.md)。
