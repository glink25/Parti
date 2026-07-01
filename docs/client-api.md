# Room UI API（全局 `parti`）

`index.html` 是房间 UI，运行在一个 **沙箱 iframe** 里。它通过注入的全局对象
`parti` 与 Runtime 通信——**不需要 import 任何东西，`parti` 直接可用**。

源码：`packages/client-sdk/src/bootstrap.ts`。

## 1. 完整 API

```ts
interface Parti {
  playerId: string | null;

  getState(): unknown;
  onState(handler: (state: unknown) => void): () => void;
  onEvent(event: string, handler: (payload: unknown) => void): () => void;

  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  leave(): void;
  log(...args: unknown[]): void;
}
```

### `parti.playerId: string | null`

当前玩家的 id。**初始为 `null`**，房间初始化（收到 init）后才被赋值。第一次
`onState` 回调触发时它已就绪，所以在 `onState` 回调里读它是安全的；在顶层同步代码里
读可能还是 `null`。

### `parti.onState(handler) => unsubscribe`

订阅权威状态。`state` 每次变化时 `handler(state)` 被调用。

- 订阅时若已有 state，会**立即同步回调一次**（不必等下次变化）。
- 返回一个**取消订阅函数**，调用它即可移除该 handler。
- 典型用法：在 handler 里**整体重渲染** UI。

```js
const off = parti.onState((state) => render(state));
// 不再需要时： off();
```

### `parti.onEvent(event, handler) => unsubscribe`

订阅由逻辑侧 `ctx.broadcast(event, ...)` / `ctx.send(..., event, ...)` 发出的一次性事件。
`handler(payload)` 收到事件 payload。返回取消订阅函数。

```js
parti.onEvent('game:over', (p) => {
  alert(p.winner === parti.playerId ? '你赢了' : '你输了');
});
```

> **事件是一次性的**，错过不补发；持久状态请从 `onState` 拿。

### `parti.action(action, payload?) => Promise<{ ok: true }>`

提交一次玩家意图，触发逻辑侧对应的 `actions[action]` handler。

- `payload` 省略时按 `null` 处理。
- ⚠️ **返回的 Promise 会立即 resolve 为 `{ ok: true }`，它只表示「已发出」，
  不代表服务端已处理、更不代表操作成功/合法。** 不要用它判断成败——成败要看
  随后的 `onState`（状态变了）或 `onEvent`（收到结果事件）。

```js
button.onclick = () => parti.action('mark', { cell: 4 });
```

### `parti.ready(): void`

告诉 Runtime「本玩家已就绪」，触发逻辑侧 `onReady(ctx, player)`。**幂等**，重复调用无副作用。
许多简单房间在脚本末尾直接调用一次即可。

### `parti.leave(): void`

主动离开房间。

### `parti.getState(): unknown`

同步读取当前最新 state（无订阅）。大多数时候用 `onState` 即可。

### `parti.log(...args): void`

把日志送到宿主页 DevTools，便于调试沙箱内代码。

## 2. 沙箱限制

Blob 与 filesystem package 统一运行在
`sandbox="allow-scripts allow-same-origin"` 的 iframe 中：

- 两种 package 都与宿主页保持同源；当前应仅运行可信 package，游戏通信仍应使用 `parti`。
- `packageMode` 只决定资源加载方式，不改变 iframe 权限。更严格的安全限制将由独立机制提供。
- 沙箱不等于网络防火墙。外部请求仍服从浏览器 CORS，`permissions.network` 当前仅为声明。
- `packageMode: "filesystem"` 时可以用普通相对路径加载 package 内文件；`blob` 模式不提供该能力。
- 不需要、也不能 `import` SDK——`parti` 是注入的全局对象。
- 普通的 DOM 操作、内联 `<style>`、`<script>` 都正常可用。

## 3. 推荐写法：onState 重渲染 + onEvent 处理瞬时反馈

```js
// 1. 状态驱动：onState 里把整个界面按 state 重画
function render(state) {
  // 根据 state.phase 切换界面、根据 state.board 画棋盘……
}
parti.onState(render);

// 2. 瞬时反馈：onEvent 处理「刚刚发生的事」（动画/提示音/弹窗）
parti.onEvent('guess:wrong', (p) => {
  if (p.playerId === parti.playerId) flash('再试试');
});

// 3. 交互：按钮 -> action
submitBtn.onclick = () => parti.action('guess', { text: input.value });

// 4. 入场：标记就绪
parti.ready();
```

完整的、可运行的 UI 范例见 [示例：井字棋](./example-tic-tac-toe.md)。
