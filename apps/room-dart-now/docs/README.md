# 飞镖时刻（dart-now）文档索引

本目录描述 `room-dart-now` 的设计契约。实现按 [refactor-plan](./refactor-plan.md) 的
目标结构**从零重写**（`version 1.0.0`，state schema `dart-now@1`），玩法与数值不变，
事件命名空间为 `dart:*`。

- [游戏流程分析](./game-flow.md)——规则、数值、阶段/玩家状态机、回合生命周期、随机事件系统。
- [联机与延迟处理机制](./networking.md)——权威模型、逻辑时钟、本地预测 + 服务端校验、
  看门狗、重对齐、断线恢复，以及全部事件/Action 契约。
- [核心需求与重构技术方案](./refactor-plan.md)——需求清单、痛点、重构目标与模块划分
  （其 §4 的目标结构已作为新实现的初始结构落地）。

## 源码地图

| 文件 | 职责 |
| --- | --- |
| `src/shared/constants.ts` | 全部数值常量，单一来源。 |
| `src/shared/protocol.ts` | 协议类型：GameState / TurnSnapshot / ShotCommit / 事件 payload + schema 常量。 |
| `src/shared/rules.ts` | 纯函数几何/规则库：角度、旋转模型、碰撞、计分、区域判定、洗牌、座位。**无框架依赖，客户端与 worker 共用。** |
| `src/shared/shot.ts` | 延迟无关核心协议函数：`simulateShot` / `validateShotCommit` / `applyShotOutcome` / `timeoutDamage`。`applyShotOutcome` 是 Worker 权威应用与客户端预测共用的唯一实现。 |
| `src/shared/lobby.ts` | 大厅就绪判定、结算排名。 |
| `src/worker/index.ts` | 权威房间逻辑（`defineRoom`）：生命周期 + actions 编排。 |
| `src/worker/turns.ts` | 回合推进、commit 应用、超时结算、看门狗。 |
| `src/worker/events.ts` | 随机事件调度。 |
| `src/worker/context.ts` | Worker 侧本地类型（替代 `any`）。 |
| `src/client/replica.ts` | LocalReplica 显式状态机：本地副本、预测、重对齐、远程镖合并；迁移集中在 `handleSnapshot / handleRejected / handleRemoteShot / tick / shoot` 五个入口。 |
| `src/client/net.ts` | `parti.onState` / `onEvent` 全部 handler → 驱动 replica、反馈与音效。 |
| `src/client/render/scene.ts` | Canvas：标靶/镖/座位/飞行/弹分（纯绘制，输入为视图模型）。 |
| `src/client/render/hud.ts` | 发射按钮（倒计时环）、事件/轮次指示。 |
| `src/client/render/overlay.ts` | 大厅/结算 overlay。 |
| `src/client/audio.ts` / `feedback.ts` | WebAudio 音效；瞬时反馈队列。 |
| `src/client/main.ts` | 入口：DOM 获取、parti 接线、帧循环（rAF 渲染 + 250ms setInterval 逻辑兜底）。 |
| `src/shared/*.test.ts` | 纯逻辑测试（延迟无关仿真、commit 校验、碰撞计分、回合时长、大厅就绪）。 |
| `public/parti.room.json` | 房间清单：2–8 人、snapshot 同步、action 声明。 |

## 一句话架构

权威状态在房主浏览器的 Worker 里（snapshot 全量同步）；每回合是一条**逻辑时间轴**，
出手方在本地**确定性仿真**自己的一镖并把完整结果（含落点、得分、旋转锚点）作为
commit 提交，Worker 只做**结构校验**不重新仿真——因此网络延迟不影响游戏结果，
只影响动画呈现时机。详见 [networking.md](./networking.md)。
