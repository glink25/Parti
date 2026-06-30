# 快速开始

本篇带你建立写 Parti 房间需要的全部心智模型，并跑通第一个房间。
读完即可去看 [示例：井字棋](./example-tic-tac-toe.md) 抄一个完整的游戏。

## 1. 房间 = 三件套

```txt
my-room/
  parti.room.json   # 清单：声明房间元信息和入口文件
  index.html        # 房间 UI，运行在沙箱 iframe 里
  room.worker.js    # 房间逻辑，运行在房主浏览器的 Web Worker 里
```

- **`room.worker.js`（逻辑 / 权威 server）**——持有唯一一份**权威 state**，
  处理玩家提交的 action，决定状态如何变化。语义上像一个轻量 server。
- **`index.html`（UI / 客户端）**——渲染界面、收集用户操作。每个玩家各看到
  一份 UI，通过全局对象 `parti` 与 Runtime 通信。它**不直接触网**。
- **`parti.room.json`（清单）**——告诉 Runtime 房间叫什么、入口文件是哪些、
  几个人能玩、要什么权限。详见 [manifest.md](./manifest.md)。

## 2. 核心心智模型：Host Authoritative（房主权威）

玩家**只提交意图（action）**，不直接改最终状态；房主的 Worker 计算出权威状态后，
广播给所有人。数据流如下：

```txt
玩家点击按钮
  → parti.action('mark', { cell: 4 })          [UI, 每个玩家本地]
    → Runtime 把意图发给房主
      → room.worker.js 的 actions.mark(ctx, ...) [房主 Worker, 全局唯一]
        → 直接修改 ctx.state
          → Runtime 自动把新 state 快照广播给所有玩家
            → 每个玩家的 parti.onState(state => 渲染) 被调用 [UI]
```

你需要记住的只有两条：

1. **逻辑侧改 `ctx.state`**，不用管怎么同步——Runtime 每处理完一个输入就自动
   广播完整快照（snapshot 模式）。
2. **UI 侧在 `parti.onState` 里渲染**，在按钮事件里调 `parti.action(...)`。

你**不需要**接触 seq / ack / snapshot / postMessage / PeerJS / WebRTC——这些都被
Runtime 封装掉了。

## 3. 最小房间：多人计数器

下面是一个完整可运行的最小房间（也是仓库里的官方示例 `counter`）。

### `parti.room.json`

```json
{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "counter",
  "name": "多人计数器",
  "version": "0.1.0",
  "entry": {
    "ui": "index.html",
    "worker": "room.worker.js"
  },
  "room": { "minPlayers": 1, "maxPlayers": 8 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
```

### `room.worker.js`（逻辑）

```js
import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() {
    return { count: 0, clicks: {} };
  },

  onJoin(ctx, player) {
    ctx.state.clicks[player.id] = 0;
  },

  onLeave(ctx, player) {
    delete ctx.state.clicks[player.id];
  },

  actions: {
    increment(ctx, { player }) {
      ctx.state.count += 1;
      ctx.state.clicks[player.id] = (ctx.state.clicks[player.id] || 0) + 1;
      // 给所有玩家广播一个一次性事件（可选）
      ctx.broadcast('counter:incremented', { count: ctx.state.count });
    },
  },
});
```

### `index.html`（UI）

```html
<div style="font-family: system-ui; padding: 16px;">
  <div id="count" style="font-size: 48px; font-weight: 700;">0</div>
  <button id="inc">+1</button>

  <script>
    // 1. 订阅状态：state 变化时整体重渲染
    parti.onState((state) => {
      document.getElementById('count').textContent = String(state.count);
    });

    // 2. 订阅一次性事件（可选）
    parti.onEvent('counter:incremented', (p) => {
      console.log('当前计数', p.count);
    });

    // 3. 用户操作 -> 提交 action（不直接改 state）
    document.getElementById('inc').onclick = () => parti.action('increment');

    // 4. 进入房间后告诉 Runtime「我准备好了」
    parti.ready();
  </script>
</div>
```

就这样——三个文件，一个可联机的多人计数器。完整 API 见
[worker-api.md](./worker-api.md) 与 [client-api.md](./client-api.md)。

## 4. 怎么运行 / 调试

在仓库里：

```bash
pnpm install
pnpm dev        # 启动 Web 应用 http://localhost:5173
```

打开应用后有两种运行方式：

- **本地预览（Host + 2 玩家）**：单页内用内存 transport 起 1 个房主 + 2 个虚拟玩家，
  每人一个沙箱 iframe，房间逻辑跑在真实 Web Worker。适合开发调试，DevTools 会显示
  state / version / 消息日志。
- **PeerJS 联机**：房主生成邀请链接，他人打开即真实 WebRTC 联机。**同一份房间代码
  在两种模式下零改动**。

### 让自己的房间被官方列表加载

把三件套放进 `apps/web/public/rooms/<你的房间id>/`，例如：

```txt
apps/web/public/rooms/my-room/
  parti.room.json
  index.html
  room.worker.js
```

> ⚠️ **只有在 `parti.room.json` 的 `entry` 里声明过的文件才会被加载**。加了
> `style.css` / `client.js` 也要写进 `entry.style` / `entry.client`，否则不会被 fetch。

## 5. 下一步

- 想要一个比计数器更完整、带回合 / 胜负判断的范例 → [示例：井字棋](./example-tic-tac-toe.md)
- 逻辑侧能用的全部能力 → [worker-api.md](./worker-api.md)
- UI 侧能用的全部能力 → [client-api.md](./client-api.md)
