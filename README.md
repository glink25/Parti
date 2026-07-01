# Parti

[English](./README.en.md) | **简体中文**

**和朋友一起创造，一起游玩。**

Parti 是一个用于创建和游玩多人互动房间的 Web 平台与 Runtime。你可以从模板开始、导入自己的房间代码，随后通过链接或二维码邀请朋友加入；房间创作者只需编写 HTML 和 JavaScript，状态同步、网络连接、沙箱与断线恢复由 Runtime 处理。

| 我想…… | 从这里开始 |
| --- | --- |
| 体验 Parti | [打开线上版本](https://parti.linkai.work/)，浏览大厅、创建房间并邀请朋友 |
| 创建一个房间 | 阅读[房间开发快速开始](./docs/getting-started.md)，或从[完整井字棋示例](./docs/example-tic-tac-toe.md)开始 |
| 参与开发 | 查看[本地开发](#本地开发)和[项目结构](#项目结构) |

## Parti 能做什么

- **创建与导入**：使用空白房间或内置模板开始，在编辑器中修改房间文件，也可以从 ZIP 或 GitHub 导入房间包。
- **即时联机**：房主在浏览器中创建房间，通过 WebRTC 与玩家连接；房间代码可由房主点对点分发。
- **轻松邀请**：支持邀请链接、二维码、4 位数字密码，以及可选的公开在线大厅。
- **专注玩法**：创作者只提交 action、更新权威 state；Runtime 负责协议、完整状态快照与事件广播。
- **隔离运行**：房间 UI 运行在沙箱 iframe 中，权威逻辑运行在房主的 Web Worker 中。
- **从中断中恢复**：房主刷新可恢复现场，玩家刷新或短暂掉线可回到原有身份和座位。
- **开箱即玩**：仓库内置多人聊天、计数器、猜词、贪吃蛇和斗地主等房间。

Parti 采用 **Host Authoritative** 模型：玩家只发送操作意图，房主浏览器中的 Worker 维护唯一权威状态并将结果同步给所有玩家。创作者无需直接处理 WebRTC、`postMessage`、序列号或确认机制。

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

将三个文件放入 `apps/web/public/rooms/<room-id>/`，或打包为 ZIP 后在 Parti 中导入。完整开发流程和约束见[房间开发文档](./docs/README.md)。

## 本地开发

需要 Node.js、[pnpm](https://pnpm.io/) 以及支持 WebRTC 和 Web Worker 的现代浏览器。

```bash
pnpm install
pnpm dev        # 启动 Web 应用：http://localhost:5173
pnpm test       # 运行协议与 Runtime 测试
pnpm typecheck  # 检查整个 monorepo 的类型
pnpm build      # 构建 Web 应用
```

开发环境提供本地多人预览和 DevTools；它们不会出现在生产构建中。即使没有配置大厅服务，仍然可以创建私密房间并通过邀请链接加入。

### 可选配置

复制 [`.env.example`](./.env.example)，按需设置：

```bash
# 启用公开在线大厅
VITE_LOBBY_SERVICE_URL=https://<project-ref>.supabase.co/functions/v1/parti-lobby

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
| [Host Runtime](./docs/host-runtime.md) | 准入、容量、恢复与安全边界 |
| [协议参考](./docs/protocol-reference.md) | 底层消息、状态同步与错误码 |
| [大厅服务](./docs/lobby-service.md) | REST API、租约、部署与 CORS |
