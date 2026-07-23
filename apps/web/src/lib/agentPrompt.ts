/**
 * 生成"邀请 AI"提示词：指导一个 AI agent 用无头浏览器接入 Parti 房间，
 * 并通过顶层 window.__partiAgent 读取状态、理解规则、提交操作来游玩。
 *
 * 提示词是给外部 AI agent 直接复制使用的自然语言 + 代码示例，仅中文。
 */

export interface AgentPromptInput {
  agentUrl: string;
  roomTitle: string;
}

export function buildAgentPrompt({ agentUrl, roomTitle }: AgentPromptInput): string {
  return `你被邀请作为一名自主玩家加入一个 Parti 多人游戏房间，请用无头浏览器接入并游玩。

房间：${roomTitle}
接入链接：${agentUrl}

重要前提：
- 请用一个全新的浏览器实例 / 独立的用户数据目录（user-data-dir）打开该链接，不要复用已有的浏览器会话，避免同机的多个 agent 或人类玩家会话相互干扰。
- 请给自己起一个独特、简洁的名字，并通过在接入链接后追加 \`&name=<你的名字>\`（需 URL 编码）来设置，方便其他玩家区分你。例如：${agentUrl}&name=小炬。
- 该链接通过 WebRTC / 实时网络联机，无头环境需具备可用网络；若连接失败请重试。
- 连接成功后，不要中断你的agent对话，确保自己始终能够运行下去，以便持续进行游戏，但需要确保无头浏览器进程不会太大压垮系统内存
- 如果你有其他浏览器技能，请务必确认你的浏览器功能和安全策略允许你直接读取/调用控制台对页面进行操作，否则请使用其他无头浏览器方式访问

Parti 是客户端渲染，实时数据在页面 JS 内存中、不在 HTML 里，所以请通过顶层 window.__partiAgent 读取和操作，而不是解析页面 DOM。接入后它提供：
- __partiAgent.status() → 'connecting' | 'connected' | 'error' | 'closed'；等到 'connected' 再开始。
- __partiAgent.playerId() → 你的玩家 id。
- __partiAgent.getState() → 当前完整游戏状态（JSON，权威快照）。
- __partiAgent.stateVersion → 每次状态变化 +1，轮询它判断是否需要重读。
- __partiAgent.describe() → 房间为 AI 提供的"转述"：规则、当前阶段、可用操作及其参数取值范围（文字/结构化）。为 null 时说明该房间未提供，请直接读 getState() 自行推断。
- __partiAgent.drainEvents() → 取出并清空自上次以来的一次性事件。
- __partiAgent.action(name, payload) → 提交一次操作；返回 { ok: true } 仅代表"已发出"，成败与合法性要看随后的 getState() 与事件。
- __partiAgent.ready() → 标记就绪（很多房间需所有人 ready 后才开始，连接后先调用一次）。
- __partiAgent.leave() → 离开房间。

节省 token（重要）：
- 优先使用 describe()（房间已把局面转述成精简文字），其次是 getState()（结构化 JSON）。尽量避免直接读取页面 HTML 原始文档或截图——它们体积大、噪音多，会大量消耗 token；只有在 describe() 为 null 且 getState() 仍不足以理解时才考虑截图。
- 部分游戏状态更新可能非常频繁。不要每次变化都重读：先用 stateVersion / drainEvents() 判断是否有"与你决策相关"的变化，只在轮到你行动或出现关键事件时才读取完整 state；空闲时降低轮询频率（如加大轮询间隔），避免无意义的重复读取消耗 token。

上述内容也镜像为页面文本（#parti-agent-guide、#parti-agent-state），但同样地，除非必要，不要整页读取。

建议流程：
1. 打开链接（可带 &name=），轮询直到 status() === 'connected'。
2. 调用 ready()。
3. 调用 describe() 理解规则与当前可用操作；若为 null 则读 getState() 推断。
4. 循环：用 stateVersion / drainEvents() 判断是否需要行动 → 需要时读取 getState()/describe() → 依据规则决策 → action() → 等待下一次相关变化 → 重复。
5. 按规则正常游玩；你是众多玩家之一，可能同时有人类玩家。

Playwright 示例：
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext(); // 全新上下文，避免复用
  const page = await context.newPage();
  await page.goto(${JSON.stringify(agentUrl)} + '&name=' + encodeURIComponent('你的名字'));
  await page.waitForFunction(() => window.__partiAgent && window.__partiAgent.status() === 'connected');
  await page.evaluate(() => window.__partiAgent.ready());
  const guide = await page.evaluate(() => window.__partiAgent.describe());
  // 仅在需要时再读完整 state：
  const state = await page.evaluate(() => window.__partiAgent.getState());
  // 决策后提交操作：
  // await page.evaluate(() => window.__partiAgent.action('<action名>', { /* payload */ }));`;
}
