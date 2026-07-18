# 飞镖轮盘（dart-roulette）重构文档索引

本目录是为「整体重构 room-dart-roulette」准备的梳理文档，基于当前实现
（`version 0.2.0`，state schema `dart-roulette@2`）逐文件核对写成。

- [游戏流程分析](./game-flow.md)——规则、数值、阶段/玩家状态机、回合生命周期、随机事件系统。
- [联机与延迟处理机制](./networking.md)——权威模型、逻辑时钟、本地预测 + 服务端校验、
  看门狗、重对齐、断线恢复，以及全部事件/Action 契约。
- [核心需求与重构技术方案](./refactor-plan.md)——需求清单、现状评估、痛点、重构目标与模块划分建议。

## 源码地图

| 文件 | 职责 |
| --- | --- |
| `src/worker/logic.ts` | 纯函数几何/规则库：角度、旋转模型、碰撞、计分、区域判定、洗牌。**无框架依赖，客户端与 worker 共用。** |
| `src/shared.ts` | 共享类型 + 回合/提交（commit）模型 + `simulateShot` / `validateShotCommit` / `applyPredictedShot` 等延迟无关的核心协议函数。 |
| `src/worker/index.ts` | 权威房间逻辑（`defineRoom`）：大厅、回合推进、commit 校验与应用、随机事件、看门狗、淘汰与胜利。 |
| `src/main.ts` | 客户端全部内容：本地副本（replica）与预测、Canvas 渲染、音效、反馈队列、大厅/结算 UI、`parti` 事件接线。 |
| `src/shared.test.ts` / `src/worker/logic.test.ts` | 纯逻辑测试（延迟无关仿真、commit 校验、碰撞计分、回合时长、大厅就绪）。 |
| `public/parti.room.json` | 房间清单：2–8 人、snapshot 同步、action 声明。 |

## 一句话架构

权威状态在房主浏览器的 Worker 里（snapshot 全量同步）；每回合是一条**逻辑时间轴**，
出手方在本地**确定性仿真**自己的一镖并把完整结果（含落点、得分、旋转锚点）作为
commit 提交，Worker 只做**结构校验**不重新仿真——因此网络延迟不影响游戏结果，
只影响动画呈现时机。详见 [networking.md](./networking.md)。
