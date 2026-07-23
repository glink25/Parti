# AI Agent 接入（自由接入）

Parti 允许房主邀请一个 **AI agent** 作为普通玩家加入房间游玩。AI 用无头浏览器打开一个
**agent 接入链接**，页面在顶层 `window` 暴露一个稳定的桥 `window.__partiAgent`，AI 通过
控制台 / `page.evaluate` 直接读取状态、理解规则并提交操作。

这套能力**不改动 `room.worker.js` 与底层协议**：agent 与普通玩家走完全相同的加入、
快照同步、重连路径；「agent 模式」只是本客户端的一个纯前端标志，用来启用房间 UI 的
「转述」并暴露 `window.__partiAgent`。

面向对象：
- **房主 / 玩家**：点邀请面板里的「邀请 AI」按钮，复制提示词交给 AI agent。
- **房间创作者**：可选地实现 `parti.exposeToAgent`（见 [client-api.md §4](./client-api.md)）
  为 AI 提供文字版规则说明。
- **AI agent（无头浏览器）**：使用下面的 `window.__partiAgent` 契约游玩。

## 房主怎么邀请

进入联机房间后（PeerJS / 局域网 / Supabase 均可），邀请面板里除了普通邀请链接，还有
一个「邀请 AI」按钮。点击会把一段**提示词**复制到剪贴板，内容包含 agent 接入链接和
下面契约的用法。把它交给你的 AI agent 即可。

> 同机运行多个 agent 时，请让每个 agent 使用**全新的浏览器实例 / 独立 user-data-dir**，
> 避免会话相互干扰。

## agent 接入链接与路由

agent 链接形如：

```txt
<origin>/#/online/agent/<roomId>/<connectionInfo>?adapter=...
```

它与普通加入链接 `#/online/join/...` 参数一致，只是路由段是 `agent`。可选地追加
`&name=<名字>`（URL 编码）为 agent 设置一个独特简洁的显示名，便于其他玩家区分。打开后页面会：

1. 像普通玩家一样通过 transport 加入房间；
2. 以 agent 模式渲染房间 iframe（触发房间的 `parti.exposeToAgent` 转述）；
3. 在顶层 `window` 暴露 `window.__partiAgent`；
4. 把 `state` / `describe` / 事件镜像成页面文本（`#parti-agent-state`、
   `#parti-agent-guide`、`#parti-agent-status`），供只读 DOM 或截图的 agent 使用。

## `window.__partiAgent` 契约

因为 Parti 是客户端渲染，实时状态在页面 JS 内存里、不在 HTML 中，所以 agent 应通过这个
全局对象读写，而不是解析 DOM：

```ts
interface PartiAgentBridge {
  version: number;                 // 契约版本，当前为 1
  status(): 'connecting' | 'connected' | 'error' | 'closed';
  playerId(): string | null;
  error(): string | null;
  getState(): unknown;             // 当前完整权威状态
  stateVersion: number;            // 每次状态变化 +1，可轮询
  describe(): unknown;             // 房间提供的转述；未提供时为 null
  action(name: string, payload?: unknown): { ok: true };  // 仅表示"已发出"
  ready(): void;                   // 标记就绪，幂等
  drainEvents(): Array<{ event: string; payload: unknown; ts: number }>;
  leave(): void;
}
```

- `action()` 返回 `{ ok: true }` 只代表「已发出」，成败与合法性要看随后的 `getState()`
  与事件（与 `parti.action` 语义一致）。
- `describe()` 为 `null` 时说明该房间未实现转述，agent 应直接读 `getState()` 推断。

## 推荐游玩流程

1. 打开 agent 链接，轮询直到 `status() === 'connected'`。
2. 调用 `ready()`。
3. 调用 `describe()` 理解规则与当前可用操作；为 `null` 则读 `getState()`。
4. 循环：读 `getState()` / `describe()` / `drainEvents()` → 依规则决策 →
   `action()` → 等 `stateVersion` 变化或新事件 → 重复。

Playwright 最小示例：

```js
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(AGENT_URL);
await page.waitForFunction(() => window.__partiAgent?.status() === 'connected');
await page.evaluate(() => window.__partiAgent.ready());
const guide = await page.evaluate(() => window.__partiAgent.describe());
const state = await page.evaluate(() => window.__partiAgent.getState());
// 决策后：
// await page.evaluate(() => window.__partiAgent.action('mark', { cell: 4 }));
```

## 安全与边界

- agent 占用一个正常的玩家席位，受房间 `maxPlayers` 与准入（密码）约束；有密码时链接
  自带 `?password=`。
- 转述运行在**本玩家视角**的房间 UI 内，拿不到别人的隐藏状态，因此不会泄露谜底/身份；
  创作者仍不应把私密事件里的他人信息写进转述。
- `window.__partiAgent` 只控制**本客户端这个 agent 玩家的席位**，不触及房主权威逻辑。
- agent 接入需要无头环境具备可用网络（WebRTC / 实时联机）。
