# 让游戏适配 AI 接入与无障碍（`parti.exposeToAgent`）

本文面向**房间创作者**，讲如何让你的游戏更好地被 **AI agent** 游玩——核心手段只有一个：
用 `parti.exposeToAgent` 给游戏写一份**文字转述**。AI agent 可以作为普通玩家接入任意
Parti 房间（接入与消费链路见文末 [§ 背景](#背景ai-如何接入并消费这份转述)），
不做任何适配它也能玩：它会去读 `getState()` 的原始状态硬猜。但只要你把「此刻发生了
什么、你能做什么」讲成人话，就能一举拿到三重收益：

- **增加文本描述** —— 直接给结论，降低 AI 的理解成本与试错。
- **减少 token 消耗** —— 只说本视角必要信息，并把动作收窄到此刻合法，减少来回试错。
- **同步支持无障碍** —— 同一段文字可复用为读屏说明（`aria-live`），服务视障玩家。

> `exposeToAgent` 的原始契约（签名、调用时机、返回值要求）见
> [client-api.md §4](./client-api.md)。本文讲**怎么把它写好**。

## 核心：注册一个转述函数

```js
parti.exposeToAgent((state) => ({
  summary: '井字棋。X 先手，三连即胜。',
  narrative: state.turn === parti.playerId ? '轮到你落子。' : '等待对手落子。',
  isYourTurn: state.turn === parti.playerId,
  yourMark: state.marks[parti.playerId],
  availableActions: state.turn === parti.playerId
    ? [{ name: 'mark', hint: '在空格落子', payloadSchema: { type: 'object', properties: { cell: { enum: emptyCells(state) } }, required: ['cell'] } }]
    : [],
}));
```

要点（详见 [client-api.md §4](./client-api.md)）：

- **完全可选**：不注册也能被 agent 游玩（退化为读 `state` 推断）。
- **只在 agent 模式下执行**：普通人类玩家永不触发，对游戏流程零影响、零开销。
- **每次状态变化都会用最新 `state` 重新调用**，结果推送给 agent 的 `describe()`。
- **运行在本玩家视角**：只拿得到该玩家可见的信息（详见 [§ 安全与视角边界](#安全与视角边界)）。
- 返回值必须**可 JSON 序列化**（对象或字符串皆可）。

## 写好转述的三条原则

### 1. 用自然语言描述此刻（增加文本描述）

把「现在轮到谁、发生了什么、你看到什么」讲成完整的话，别让 AI 自己解读字段含义。

- **`summary` / `objective`** 讲清规则与获胜目标——静态、精简。
- **`narrative`** 讲清当前局面——动态、本视角，例如「轮到你出牌，上一手是小明的一对 8」。
- 直接给**结论**而不是原料：写「轮到你出牌」，而不是丢一个 `turn === playerId` 让它自己算。
- 需要术语解释时用 **`glossary`**：把状态字段（`phase`、`role`、`currentPlayerId` 等）
  的含义一次性说清，AI 读一遍即可对照 `getState()`。

### 2. 把动作收窄到「此刻合法」（少试错，也省 token）

这是**最能省 token** 的一条：AI 每提交一次非法操作，就要多一轮「读状态 → 发现失败
→ 重试」，直接烧掉 token 并拖慢节奏。

- **`availableActions` 只列此刻能做的动作**；做不了的动作就不要出现。
- 用 **`enum` / schema 把参数收窄到合法取值**——例如只枚举你手上打得出的牌 `id`、
  只列出还活着的可选目标、叫分只给「比当前分更高」的选项。
- 每个动作给 `name` + `hint`（何时/怎么用）+ `payloadSchema`，必要时附 `examples`。

```js
availableActions: [
  {
    name: 'playCards',
    hint: isLead ? '首出：自由选择合法牌型' : '跟牌：需同牌型更大，或用炸弹/火箭',
    payloadSchema: { type: 'object', properties: { cardIds: { type: 'array', items: { enum: hand.map((c) => c.id) } } }, required: ['cardIds'] },
    examples: legalPlays.slice(0, 6).map((cards) => ({ cardIds: cards.map((c) => c.id) })),
  },
  ...(canPass ? [{ name: 'pass', hint: '本轮不出' }] : []),
]
```

### 3. 只说必要信息（减少 token 消耗）

转述是**导读与收窄**，不是把 `getState()` 再序列化一遍——agent 本就能读到原始 `state`，
重复只会让每一帧的 token 翻倍。

- **不要复述整个 state**，只补充理解：结论、合法项、关键变化。
- **只描述本视角可见信息**（既省 token 又天然不泄密）。
- 历史用**近况摘要**（最近若干条 `recentEvents`），不要贴全量日志。
- **静态说明保持精简**：`summary` / `glossary` 每次状态变化都会重发一次，别写成长篇。
- 长数组、原始数值能省则省——给「合法取值」而不是「全部可能」。

## 推荐的转述结构

下面这套字段被本仓库多个游戏（斗地主、麻将、狼人杀、谁是卧底等）实际采用，可直接照抄：

```js
parti.exposeToAgent((state) => ({
  summary: '一句话说清这是什么游戏、怎么赢。',        // 静态、精简
  objective: '你的目标与结算规则。',                  // 静态
  glossary: { phase: '各阶段含义…', role: '各身份含义…' }, // 静态术语表
  phase: state.phase,                                 // 当前阶段
  narrative: '本视角此刻的局面（完整句子）。',         // 动态、本视角
  isYourTurn: /* 是否轮到你行动 */ false,
  waitingFor: '若在等别人，说明在等谁做什么。',        // 可选
  recentEvents: ['最近发生的若干条事件摘要'],          // 可选，近况而非全量
  availableActions: [/* 只列此刻合法的动作，见原则 2 */],
}));
```

- 只轮到某玩家时才给出动作的 `availableActions`；轮不到就置空并用 `waitingFor` 说明。
- 隐藏信息（手牌、身份）从**本玩家收到的私密事件**里取（见下），不要去猜别人的。

## 同步支持无障碍（读屏）

`exposeToAgent` **只在 agent 模式执行**，人类玩家不会触发它。所以要让无障碍也吃到这份
描述，做法是：**把「描述当前局面」抽成一个纯函数，两处复用**——

```js
function describeView(state) {
  // 返回 { narrative, availableActions, ... }：既是 AI 转述，也是读屏字幕
}

// 1) AI 模式：交给转述
parti.exposeToAgent(describeView);

// 2) 人类模式：把同一段 narrative 写进一个 aria-live 的视觉隐藏区，读屏会朗读
parti.onState((state) => {
  render(state);
  liveRegion.textContent = describeView(state).narrative;
});
```

```html
<!-- 视觉隐藏但读屏可读的实时播报区 -->
<div id="live" aria-live="polite" class="sr-only"></div>
```

- 把 `narrative` 当**字幕**来写：完整句子、含玩家名 / 回合 / 关键变化，AI 与读屏都受用。
- 一份逻辑、两个出口，避免「AI 有说明、视障玩家没有」的割裂。
- 提示：真正的无障碍达标（如 WCAG）还需用读屏等辅助技术做人工验证与专家评审；
  本文只提供可复用的实践模式，不代表自动合规。

## 安全与视角边界

- 转述运行在**本玩家视角**的房间 UI 内，天然拿不到别人的隐藏状态（谜底 / 身份 / 底牌），
  因此**不会泄露秘密**。
- 但仍**不要把通过私密事件收到的他人信息**写进转述。
- 只描述本席位**可见**的信息、本席位**能做**的操作。

## 背景：AI 如何接入并消费这份转述

这一节讲你的转述最终「流向哪里」，便于理解，通常无需改动代码。

**房主怎么邀请**：进入联机房间后（PeerJS / 局域网 / Supabase 均可），邀请面板里除了
普通邀请链接，还有「邀请 AI」按钮，点击会把一段**提示词**（含 agent 接入链接与用法）
复制到剪贴板，交给 AI agent 即可。同机运行多个 agent 时，请让每个 agent 使用**全新的
浏览器实例 / 独立 user-data-dir**，避免会话相互干扰。

**接入链接与路由**：agent 链接形如

```txt
<origin>/#/online/agent/<roomId>/<connectionInfo>?adapter=...
```

它与普通加入链接 `#/online/join/...` 参数一致，只是路由段是 `agent`；可选追加
`&name=<名字>`（URL 编码）设置显示名。它**不改动 `room.worker.js` 与底层协议**：agent
与普通玩家走完全相同的加入、快照同步、重连路径。「agent 模式」只是本客户端的一个纯前端
标志，用来启用房间 UI 的转述并暴露 `window.__partiAgent`。

**agent 怎么消费**：因为 Parti 是客户端渲染，实时状态在页面 JS 内存里、不在 HTML 中，
所以 agent 通过顶层 `window.__partiAgent` 读写，而不是解析 DOM：

```ts
interface PartiAgentBridge {
  version: number;                 // 契约版本，当前为 1
  status(): 'connecting' | 'connected' | 'error' | 'closed';
  playerId(): string | null;
  error(): string | null;
  getState(): unknown;             // 当前完整权威状态
  stateVersion: number;            // 每次状态变化 +1，可轮询
  describe(): unknown;             // 你用 exposeToAgent 注册的转述；未注册时为 null
  action(name: string, payload?: unknown): { ok: true };  // 仅表示“已发出”
  ready(): void;                   // 标记就绪，幂等
  drainEvents(): Array<{ event: string; payload: unknown; ts: number }>;
  leave(): void;
}
```

- `describe()` 返回的就是你的转述；为 `null` 说明该房间未适配，agent 退化为读 `getState()` 推断。
- `action()` 返回 `{ ok: true }` 只代表「已发出」，成败要看随后的 `getState()` 与事件。
- 页面还会把 `state` / `describe` / 事件镜像成文本节点（`#parti-agent-state`、
  `#parti-agent-guide`、`#parti-agent-status`），供只读 DOM 或截图型 agent 使用——
  这也是「转述写得好，截图型 agent 也受益」的原因。

**推荐游玩流程**（agent 侧）：连上 → `ready()` → 读 `describe()` 理解局面与合法操作
（为 `null` 则读 `getState()`）→ 决策 → `action()` → 等 `stateVersion` 变化或新事件 → 重复。

```js
const { chromium } = require('playwright');
const page = await (await (await chromium.launch()).newContext()).newPage();
await page.goto(AGENT_URL);
await page.waitForFunction(() => window.__partiAgent?.status() === 'connected');
await page.evaluate(() => window.__partiAgent.ready());
const guide = await page.evaluate(() => window.__partiAgent.describe()); // ← 你的转述
// 决策后：await page.evaluate(() => window.__partiAgent.action('mark', { cell: 4 }));
```

- agent 占用一个正常的玩家席位，受房间 `maxPlayers` 与准入（密码）约束；有密码时链接
  自带 `?password=`。
- agent 接入需要无头环境具备可用网络（WebRTC / 实时联机）。
