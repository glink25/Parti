# Parti 房间开发文档

> 用 **HTML + JavaScript** 写一个多人互动房间——你只关心游戏逻辑，
> 同步、网络、重连、沙箱全部由 Parti Runtime 代办。

这套文档面向**房间创作者**（人类或 AI agent）。读完《快速开始》+《示例：井字棋》
两篇，你就能独立写出一个可运行的房间。其余几篇是按需查阅的 API 参考。

## 一个房间 = 三个文件

```txt
my-room/
  parti.room.json   # 清单：房间元信息 + 入口文件声明
  index.html        # 房间 UI（运行在沙箱 iframe，通过全局 parti 通信）
  room.worker.js    # 房间逻辑（权威 server，运行在房主的 Web Worker）
```

## 文档导航

| 文档 | 内容 | 何时读 |
| --- | --- | --- |
| [getting-started.md](./getting-started.md) | 心智模型、三件套、如何运行 | **先读这篇** |
| [example-tic-tac-toe.md](./example-tic-tac-toe.md) | 从零写一个完整井字棋，可直接复制运行 | 想要可抄的完整范例 |
| [worker-api.md](./worker-api.md) | `defineRoom` / `ctx` / 生命周期 / action 完整参考 | 写房间逻辑时查 |
| [client-api.md](./client-api.md) | 全局 `parti.*` UI API 完整参考 | 写房间 UI 时查 |
| [manifest.md](./manifest.md) | `parti.room.json` 字段表 | 配置清单时查 |
| [protocol-reference.md](./protocol-reference.md) | 底层协议消息 / 错误码（进阶、可选） | 一般无需阅读 |

平台与 Runtime 集成文档：

| 文档 | 内容 | 面向对象 |
| --- | --- | --- |
| [host-runtime.md](./host-runtime.md) | Host 准入控制器、容量状态和秘密边界 | 平台 / Transport 集成者 |
| [lobby-service.md](./lobby-service.md) | 在线大厅 REST API、租约和部署要求 | 大厅后端实现者 |

## 推荐阅读路径

**「我想尽快写出一个房间」**：
[getting-started](./getting-started.md) → [example-tic-tac-toe](./example-tic-tac-toe.md)
→ 照着改 → 遇到不清楚的 API 再查 [worker-api](./worker-api.md) / [client-api](./client-api.md)。

## 想了解更深的架构设计？

本文档只讲「如何写房间」。Parti 的整体架构、Transport 抽象、运行模型、未来路线
等设计意图见仓库根的 [`GOAL.md`](../GOAL.md)（技术设计文档）。

> 注意：`GOAL.md` 是设计文档，其中部分 API 是早期草案，**以本 `docs/` 与真实源码为准**。
