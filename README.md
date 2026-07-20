# Parti

[English](./README.en.md) | **简体中文**

**和朋友一起创造，一起游玩。**

Parti 是一个用于创建和游玩多人互动房间的 Web 平台与 Runtime。你可以从模板开始、导入自己的房间代码，随后通过链接或二维码邀请朋友加入；房间创作者只需编写 HTML 和 JavaScript，状态同步、网络连接、沙箱与断线恢复由 Runtime 处理。

| 我想…… | 从这里开始 |
| --- | --- |
| 体验 Parti | [打开线上版本](https://parti.linkai.work/)，浏览大厅、创建房间并邀请朋友 |
| 用 AI 快速创建 | 看[用 AI 快速创建联机游戏](#用-ai-快速创建联机游戏)：复制提示词 → 生成 → 一键导入 → 邀请联机 |
| 手写一个房间 | 阅读[房间开发快速开始](./docs/getting-started.md)，或从[完整井字棋示例](./docs/example-tic-tac-toe.md)开始 |
| 参与开发 | 查看[本地开发](#本地开发)和[项目结构](#项目结构) |

## Parti 能做什么

- **创建与导入**：使用空白房间或内置模板开始，在编辑器中修改房间文件；也可用 AI 生成房间并一键导入，或从 ZIP / GitHub 导入房间包；还可以在「房间市场」标签页浏览并一键安装社区通过 GitHub 发布的房间。
- **即时联机**：房主在浏览器中创建房间，通过 WebRTC 与玩家连接；房间代码可由房主点对点分发。
- **轻松邀请**：支持邀请链接、二维码、4 位数字密码，以及可选的公开在线大厅。
- **专注玩法**：创作者只提交 action、更新权威 state；Runtime 负责协议、完整状态快照与事件广播。
- **隔离运行**：房间 UI 运行在沙箱 iframe 中，权威逻辑运行在房主的 Web Worker 中。
- **从中断中恢复**：房主刷新可恢复现场，玩家刷新或短暂掉线可回到原有身份和座位。
- **开箱即玩**：仓库内置多人聊天、计数器、猜词、贪吃蛇和斗地主等房间。

Parti 采用 **Host Authoritative** 模型：玩家只发送操作意图，房主浏览器中的 Worker 维护唯一权威状态并将结果同步给所有玩家。创作者无需直接处理 WebRTC、`postMessage`、序列号或确认机制。

## 用 AI 快速创建联机游戏

不必先啃 API。打开 [线上版本](https://parti.linkai.work/) 的创建页，复制一段为 Parti 准备的提示词，交给 ChatGPT、Claude、Gemini 等常用 AI；它会按仓库 `docs` 约束生成完整房间代码。粘贴回复即可导入三个文件，随后用链接或二维码邀请朋友联机。

1. 在创建页点击「没有想要的游戏？让 AI 写一个」，复制提示词并发给 AI。
2. 补充玩法、玩家人数、胜负条件和视觉风格，等待 AI 生成完整回复。
3. 回到编辑页，用「快速导入 AI 结果」粘贴整段回复，自动填入 `parti.room.json`、`index.html` 与 `room.worker.js`；预览确认后创建房间并邀请好友。

AI 生成的代码仍可能有误，建议先本地预览再邀请。若更想从零手写，见下方[创建一个房间](#创建一个房间)。

## 适用场景与边界

Parti 的核心目标是服务普通人的朋友聚会、家庭娱乐、线下活动和其他轻量社交互动。它更适合彼此信任的人群共同游玩，而不是开放、对抗或高风险的公共服务。

Parti **不提供防作弊、公平竞技或安全对抗保证**。Host Authoritative 只描述状态由房主计算和同步，并不意味着房主、玩家客户端或房间代码可信。请勿将 Parti 用于赌博、奖金竞赛、金融交易、关键业务、安全敏感场景或任何违法用途。

## 创建一个房间

一个最小 Parti 房间只有三个文件：

```text
my-room/
  parti.room.json   # 元信息、入口与权限
  index.html        # 沙箱中的房间 UI
  room.worker.js    # 房主 Worker 中的权威逻辑
```

`parti.room.json`：

```json
{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "counter",
  "name": "多人计数器",
  "version": "0.1.0",
  "packageMode": "blob",
  "entry": {
    "ui": "index.html",
    "worker": "room.worker.js"
  },
  "room": { "minPlayers": 1, "maxPlayers": 8 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
```

`room.worker.js`：

```js
import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() {
    return { count: 0 };
  },
  actions: {
    increment(ctx) {
      ctx.state.count += 1;
    },
  },
});
```

`index.html`：

```html
<button id="increment">+1</button>
<strong id="count">0</strong>

<script>
  parti.onState((state) => {
    document.getElementById('count').textContent = String(state.count);
  });
  document.getElementById('increment').onclick = () => {
    parti.action('increment');
  };
  parti.ready();
</script>
```

将三个文件放入 `apps/web/public/rooms/<room-id>/`，或打包为 ZIP 后在 Parti 中导入；也可以把房间包提交到自己的公开仓库并按[房间市场](./docs/room-market.md)登记，让其他用户在市场中一键安装。完整开发流程和约束见[房间开发文档](./docs/README.md)。

## 本地开发

需要 Node.js、[pnpm](https://pnpm.io/) 以及支持 WebRTC 和 Web Worker 的现代浏览器。

```bash
pnpm install
pnpm dev        # 启动 Web 应用：http://localhost:5173
pnpm test       # 运行协议与 Runtime 测试
pnpm typecheck  # 检查整个 monorepo 的类型
pnpm build      # 先构建 apps/room-*，再构建包含这些 Room 的 Web 应用
```

开发环境提供本地多人预览和 DevTools；它们不会出现在生产构建中。即使没有配置大厅服务，仍然可以创建私密房间并通过邀请链接加入。

### 可选配置

复制 [`.env.example`](./.env.example)，按需设置：

```bash
# 启用公开在线大厅
VITE_LOBBY_SERVICE_URL=https://<project-ref>.supabase.co/functions/v1/parti-lobby

# 覆盖房间市场的 GitHub issue 注册表（默认 glink25/Parti）
VITE_MARKET_REGISTRY=<owner>/<repo>

# 构建时注入可选的 GA4 gtag HTML 片段
GA_MEASUREMENT_SNIPPET=<script>...</script>
```

大厅服务由仓库中的 Supabase Edge Function 和迁移提供。接口、租约与 CORS 约定见[大厅服务文档](./docs/lobby-service.md)。

## 项目结构

```text
apps/web/                 React + Vite Web 应用、在线大厅、编辑器与房间界面
packages/core/            协议、Host/Client Runtime 与状态同步
packages/worker-sdk/      defineRoom、RoomEngine 与 Worker 宿主
packages/client-sdk/      iframe 中的 parti API 与宿主页沙箱桥
packages/transport-local/ 本地预览和测试使用的内存 Transport
packages/transport-peerjs/基于 PeerJS / WebRTC 的联机 Transport
packages/transport-lan/   基于 LocalSend 信令与 WebRTC DataChannel 的局域网 Transport
packages/room-packager/   Manifest 校验与内容寻址房间包
supabase/                 可选的在线大厅数据库迁移与 Edge Function
docs/                     房间开发、API 和 Runtime 文档
```

核心数据流：

```text
iframe UI
  -> host bridge -> ClientRuntime -> Transport
  -> HostRuntime -> room.worker.js
  -> authoritative state -> snapshot broadcast -> every player's UI
```

Runtime 的核心原则是：Runtime First、Protocol Stable、User Code Untrusted、Host Replaceable、Actions Over Messages、Snapshot First。

## 文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](./docs/getting-started.md) | 房间模型、最小示例与运行方式 |
| [完整井字棋示例](./docs/example-tic-tac-toe.md) | 从零实现一个可运行的多人游戏 |
| [Worker API](./docs/worker-api.md) | `defineRoom`、action、上下文与生命周期 |
| [Client API](./docs/client-api.md) | iframe 中可用的 `parti.*` API |
| [Manifest](./docs/manifest.md) | `parti.room.json` 字段与约束 |
| [房间市场](./docs/room-market.md) | 发布流程、`parti.room.zip` 打包格式与标签规则 |
| [Host Runtime](./docs/host-runtime.md) | 准入、容量、恢复与安全边界 |
| [协议参考](./docs/protocol-reference.md) | 底层消息、状态同步与错误码 |
| [大厅服务](./docs/lobby-service.md) | REST API、租约、部署与 CORS |
| [局域网直连](./docs/lan-direct.md) | LocalSend 发现、网络边界、自建服务与隐私说明 |

---

## ☕️ 请我喝杯咖啡

感谢你对 Parti 的支持！Parti 目前由单人维护，你的捐赠将用于项目维护和持续开发。

### 支付宝 (Alipay)

![支付宝收款码](./apps/web/public/donation/alipay.png)

### Solana (SOL)

钱包地址：

`vEzM9jmxChx2AoMMDpHARHZcUjmUCHdBShwF9eJYGEg`

![Solana 钱包二维码](./apps/web/public/donation/solana.png)
