# Parti

一个面向 Web 的**多人互动房间 Runtime**。创作者用 HTML + `room.worker.js`
快速创作房间，Parti Runtime 负责标准协议、状态同步、沙箱与可替换通信层。

当前版本提供完整的在线大厅、房间创作、邀请加入、状态同步与断线恢复体验。

**想写一个房间？** 看 [`docs/`](./docs/) 开发文档 —— 读完《快速开始》+《井字棋示例》
即可写出一个可运行的多人房间。

## 快速开始

```bash
pnpm install
pnpm dev        # 启动 Web 应用 (http://localhost:5173)
pnpm test       # 运行协议/runtime 单测
pnpm typecheck  # 全量类型检查
pnpm build      # 构建 Web 应用
```

打开应用后，可以从在线大厅加入正在进行的房间，也可以选择空白房间或官方模板进行
创作。点击“创建联机房间”会直接进入房主页面；房主可以分享邀请链接、设置密码，或将
房间公开到大厅。

本地预览和 DevTools 仅在 `pnpm dev` 启动的开发环境中显示，生产构建不会暴露这些入口。
底层联机适配器、沙箱和房间协议的技术说明见后续架构章节。

### 大厅服务配置

复制 [`.env.example`](./.env.example) 或在部署环境设置：

```bash
VITE_LOBBY_SERVICE_URL=https://<project-ref>.supabase.co/functions/v1/parti-lobby
```

未配置或服务不可用时，创建和链接邀请仍然正常，公开开关会保持私密并提示错误。
大厅服务 REST 接口、租约和 CORS 规则见 [`docs/lobby-service.md`](./docs/lobby-service.md)。

联机房间可设置 4 位数字密码。密码由房主 `HostRuntime` 在 Package 下载和正式加入
两个阶段校验，不上传大厅，也不会传给 `room.worker.js`。分享链接可以在 Hash 查询参数
中携带密码，便于一键加入。

## 架构（Monorepo）

```
packages/
  core/              @parti/core   —— 标准协议 + Runtime 引擎（最核心）
  worker-sdk/        @parti/worker-sdk —— defineRoom + RoomEngine + Worker 宿主
  client-sdk/        @parti/client-sdk —— iframe 内 parti.* + 宿主页沙箱桥
  transport-local/   内存模拟多人（测试/预览）
  transport-peerjs/  PeerJS / WebRTC 适配器
  room-packager/     manifest 校验 + 内容寻址 packageHash
apps/web/            Vite + React SPA：在线大厅 / 房间管理 / 运行时 / DevTools
apps/web/public/rooms/   官方示例房间包（counter / guess-word）
```

### 关键数据流

```
iframe UI (client-sdk) → 宿主页 host-bridge → ClientRuntime/HostRuntime
  → TransportAdapter → HostRuntime → Web Worker(room.worker.js)
  → 权威 state 变更 → StateSyncEngine → state:snapshot 广播
  → 各端 → iframe UI 渲染
```

核心原则（GOAL §20）：Runtime First、Protocol Stable、User Code Untrusted、
Host Replaceable、Actions Over Messages、Snapshot First。

平台接入 Host 准入控制器和权威容量状态时，参见
[`docs/host-runtime.md`](./docs/host-runtime.md)。

## 写一个房间

`parti.room.json` + `index.html` + `room.worker.js`：

```js
// room.worker.js
import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() {
    return { count: 0 };
  },
  actions: {
    increment(ctx, { player }) {
      ctx.state.count += 1;
      ctx.broadcast('counter:incremented', { count: ctx.state.count });
    },
  },
});
```

```html
<!-- index.html -->
<button id="inc">+1</button>
<script>
  parti.onState((s) => (document.title = s.count));
  document.getElementById('inc').onclick = () => parti.action('increment');
  parti.ready();
</script>
```

创作者不接触 seq / ack / transport / postMessage / snapshot —— Runtime 全部代办。

## 房间重连与持久化

重连/现场恢复是 Runtime 内置的核心机制，创作者与接入方都**不直接接触
sessionStorage**——只与 `SessionStore` 抽象交互（默认 `SessionStorageStore`，
与 manifest `permissions.storage: "session"` 一致）。

- **房主刷新**：复用稳定的 host peer id（邀请链接不变）+ 用持久化快照水合
  Worker，状态恢复；在线玩家由 `ReconnectingClient` 自动重连回来。
- **玩家刷新 / 掉线**：凭持久化 `clientId` 重连回同一玩家身份，保留分数/座位；
  掉线有宽限期（默认 30s），期内回归不丢数据，期满才真正离开。
- **生命周期跟随 sessionStorage**：是否恢复完全取决于 sessionStorage 是否还在。
  刷新页面 → 记录仍在 → 恢复现场；**退出房间回到大厅** → `clearRoomSession` 主动清除
  （并销毁仍在运行的 runtime，避免写回）→ 再进入即全新房间；关闭标签页 → 存储随之失效。
  不区分刷新方式。

创作者默认**无需改动任何代码**即获得上述能力；如需感知，可实现可选钩子
`onRestore(ctx)`（房间从快照恢复）与 `onReconnect(ctx, player)`（玩家重连回归）。
