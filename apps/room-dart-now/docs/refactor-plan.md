# 核心需求与重构技术方案

> **状态**：`room-dart-now` 已按本文 §4 的目标结构**从零重写落地**（schema `dart-now@1`、
> 事件命名空间 `dart:*`）。§2 的痛点 1–6 在新实现中均已解决（客户端模块拆分、Worker 类型化、
> `applyShotOutcome` 单一实现、LocalReplica 显式状态机、逻辑 tick 与 rAF 解耦）。
> 本文其余部分保留为需求清单与设计决策记录；§5 的「契约冻结」仅适用于当时的原地重构场景。
>
> 前置阅读：[game-flow.md](./game-flow.md)、[networking.md](./networking.md)。
> 本文把「这个游戏必须做到什么」与「当前实现的差距」分开列清，作为重构的验收依据。

## 1. 核心需求清单

### 1.1 功能性需求（重构后必须保持的行为）

- **大厅**：2–8 人；加入/离开/重连；准备切换；仅房主可开局且需全员 ready；
  大厅操作被拒时给出可读原因（`roulette:lobby-error` 的 6 种 reason）。
- **对局**：洗牌定座位与出手顺序；按序循环回合；回合时限 15s 起、每轮 −2s、下限 5s；
  标靶恒转（8s/圈基础转速）；从自己座位方向发射。
- **判定**：镖碰撞 −1 血且不钉板；安全命中按与最近敌镖边距计 10/30/60/100 分；
  多镖回合共享总时限；超时按未射支数扣血；血 0 淘汰；存活 ≤1 结束。
- **随机事件**：每 3–5 镖触发一次，6 种事件（加速/反转/4 种区域），区域 36°，
  区域中心避开现有镖，连续不重复，效果跨回合正确消费与还原。
- **实时手感**：出手方按下即见飞行与结果（零网络等待）；所有端对同一镖的结果一致。
- **容错**：任何玩家掉线不阻塞对局（看门狗 20s 兜底）；断线重连恢复席位；
  房主刷新后从快照恢复对局；commit 幂等（重复提交无副作用）。
- **结算**：胜者优先、按分数/安全命中排名；房主可带大家回大厅。

### 1.2 非功能性需求

- **延迟无关**：游戏结果不得依赖 commit 的网络到达时刻（现行逻辑时钟方案，见 networking.md §2）。
- **协议稳定**：state schema、actions、事件名是 UI 与 Worker 的契约；重构若改动契约，
  两端必须同版本发布（运行时无跨版本兼容义务，见仓库 AGENTS.md 第 1 条）。
- **纯逻辑可测**：角度/碰撞/计分/校验/回合时长等纯函数保持无框架依赖，可用 vitest 直测。
- **平台约束**：Worker 侧单文件、仅可 `import { defineRoom }`、handler 同步、无秘密入 state；
  UI 侧沙箱 iframe、仅用注入的全局 `parti`。

## 2. 现状架构评估

### 2.1 合理的部分（重构应保留）

- **逻辑时钟 + 锚点旋转模型**：`Rotation`/`logicalElapsed`/`ShotCommit` 三元组是整个游戏的
  地基，延迟无关、可校验、可测试。这是本项目最不应推翻的设计。
- **纯函数分层**：`worker/logic.ts`（几何规则）与 `shared.ts`（协议函数）干净、无框架依赖，
  测试覆盖了延迟无关仿真、校验、计分带、回合时长、大厅就绪。
- **Worker 端流程**：`index.ts` 的回合推进、事件调度、看门狗、超时处理结构清晰，约 490 行，
  复杂度可控。
- **幂等与恢复**：DUPLICATE 静默、commit-rejected 重同步、`onRestore` 重武装看门狗、
  `deferredDarts` 防重复钉镖——这些边界处理是踩过坑后的成果，重构时要逐条对应保留。

### 2.2 痛点（重构的主要动机）

1. **`src/main.ts` 单文件 646 行、五种职责混在一起**：本地副本状态机、Canvas 渲染、
   WebAudio 音效、反馈队列/Overlay/记分牌 DOM、`parti` 事件接线全部交织，
   改任何一处都要全文理解。这是当前最大的可维护性问题。
2. **Worker 侧类型缺失**：`type RoomContext = any`（worker/index.ts:29），
   所有 `ctx.state` 访问无类型保护，重构易引入静默错误。
3. **本地副本（LocalReplica）隐式状态机**：`phase: aligning/active/observing/flying/done/recovering`
   的迁移散落在 `renderFrame` 每帧的前置检查、`shootLocal`、`applyLocalShot`、`timeoutLocal`、
   `beginReplica`、`activateReplica` 中，没有集中的迁移表，新增阶段或事件源极易漏改。
4. **`shared.ts` 职责不纯**：名为 shared，实则混了协议类型、协议函数、UI 布局函数
   （`computeSceneLayout`、`flyingDartTipRadius`、`seatWorldAngle`）与大厅规则
   （`lobbyReadiness`）；且客户端 `main.ts` 直接 import `worker/logic.ts`，
   目录归属与真实依赖方向相反。
5. **校验与仿真的重复实现风险**：`applyPredictedShot`（shared.ts）与 `applyShot` /
   `applyZoneResult`（worker/index.ts）是两份平行的「应用结果」逻辑，目前手工保持一致；
   规则一旦变化（如新增区域效果）需要改两处，已出现过「预测与服务端不一致」类 bug 的典型温床。
6. **渲染与状态耦合**：`renderFrame` 每帧既驱动状态机（对齐完成、超时、飞行落地）又做绘制，
   帧循环停转（后台标签页 rAF 暂停）时本地超时判定也会停摆——依赖看门狗兜底，体验上
   表现为回前台后突然结算。
7. **防作弊弱**：结果客户端申报制（networking.md §4），当前量级可接受，但重构时应明确
   记录这一决策或升级方案。

## 3. 重构目标

1. **不动协议与玩法**：第一轮重构保持 `dart-roulette@2` 契约、全部数值与流程不变，
   只做结构重整——验收标准是现有测试全绿 + 人工联机试玩行为一致。
2. **拆分客户端**：按职责分模块，单一文件只留入口接线。
3. **补齐类型**：Worker 侧用 `defineRoom` 的泛型替代 `any`。
4. **收敛重复**：服务端与客户端共用同一份「应用一镖结果」的纯函数。
5. **显式状态机**：LocalReplica 的阶段迁移集中定义、可枚举、可测试。

## 4. 目标结构建议

### 4.1 目录与模块划分

```txt
src/
  shared/
    protocol.ts    // 类型：GameState/TurnSnapshot/ShotCommit/... + schema 常量
    constants.ts   // 全部数值常量（从 shared.ts 与 logic.ts 收拢，单一来源）
    rules.ts       // 现 worker/logic.ts：角度/旋转/碰撞/计分/区域（纯函数）
    shot.ts        // simulateShot / validateShotCommit / applyShotOutcome（纯函数）
    lobby.ts       // lobbyReadiness、turnDurationForRound、座位/布局等
  worker/
    index.ts       // defineRoom 骨架：生命周期 + actions，只做编排
    turns.ts       // beginTurn/advanceTurn/applyShot/applyTimeout/watchdog
    events.ts      // 随机事件调度（triggerRandomEvent/eventCopy）
  client/
    main.ts        // 入口：DOM 获取、parti 接线、启动
    replica.ts     // LocalReplica 状态机（§4.2）
    net.ts         // parti.onState/onEvent 的所有 handler → 驱动 replica 与 UI
    render/
      scene.ts     // Canvas：标靶/镖/玩家/特效绘制（纯绘制，输入为视图模型）
      hud.ts       // 计时环、按钮、event pill、live region
      overlay.ts   // 大厅/结算 overlay 与记分牌
    audio.ts       // 音效
    feedback.ts    // 反馈队列与动画
```

注意 `worker/logic.ts` 被客户端依赖的现状：把规则库移到 `shared/rules.ts` 后，
依赖方向变为 worker 与 client 都依赖 shared，目录语义与依赖方向一致。

### 4.2 LocalReplica 显式状态机

把现有 6 阶段整理为一张迁移表（重构后 replica.ts 的核心）：

```txt
事件来源            aligning      active        observing     flying       done/recovering
快照(新回合)   →    beginReplica（任何阶段都可重入）
rebase 完成         activate      —             —             —            —
按下发射            —             flying        —             —            —
飞行满 520ms        —             —             —      applyLocalShot
                                                        → active(还需射) / done(射满/淘汰)
到达时限            —          timeoutLocal → done   —（飞行中不判超时，由 commit 结算）
commit-rejected  →  beginReplica(recovering)（任何阶段可重入）
快照(非playing)  →  replica=null
```

要点：

- 迁移只发生在 replica.ts 暴露的 `handleSnapshot / handleRejected / tick(now) /
  shoot()` 四个入口，渲染层不再直接改 replica。
- 「每帧前置检查」收敛为 `replica.tick(now)` 一个调用，内部按当前阶段决定是否触发
  超时/落地/激活——保持现有行为，但可单测（注入 `now`）。

### 4.3 收敛「应用结果」为单一纯函数

现状：`applyPredictedShot`（客户端预测）与 `applyShot`（Worker 权威）是两份逻辑。
目标：shared 提供唯一实现

```ts
applyShotOutcome(state: { players, darts, rotation, event, turn, ... }, commit: ShotCommit): AppliedEffects
```

Worker 用它改权威 state 后按返回的 effects 决定广播哪些事件；客户端预测路径直接调它
（事件广播部分自然跳过）。区域效果、淘汰判定、统计累加只存在一份。
`applyTimeout` 同理可抽出共用伤害计算（`timeoutDamage` 已抽出，可再进一步）。

### 4.4 Worker 类型化

`@parti/worker-sdk` 的 `defineRoom` 支持泛型时改为
`defineRoom<GameState>({...})` 并为 `RoomContext` 建本地接口（替代 `any`）。
worker/index.ts 拆成 turns.ts / events.ts 后，index.ts 只剩生命周期与 action 编排。

### 4.5 帧循环与状态推进解耦（可选，低优先）

后台标签页 rAF 暂停导致本地超时停摆的问题：可在 `replica.tick` 之外加一个
低频 `setInterval`（如 250ms）仅用于驱动 `tick` 的超时/落地检查，渲染仍走 rAF。
注意行为变化需人工试玩验证；也可接受现状（看门狗兜底），仅记录在案。

## 5. 协议契约冻结清单（第一轮重构不得变更）

- state schema 字符串 `'dart-roulette@2'` 及全部字段名/结构。
- 6 个 action 名与 payload 形状（manifest 同步声明）。
- 13 个 `roulette:*` 事件名与 payload 字段。
- 全部数值常量（见 game-flow.md §2）与判定容差 0.5ms。
- 校验语义：DUPLICATE 幂等、其余拒绝并回 `commit-rejected`、看门狗 20s。

## 6. 重构步骤建议（按风险从低到高）

1. **搬常量与类型**：`shared/` 下建 protocol/constants/rules/lobby，改 import，跑测试。
2. **抽 `applyShotOutcome`**：Worker 与客户端预测共用，跑测试 + 人工试玩。
3. **Worker 拆分与类型化**：turns/events 分离，去 `any`，跑测试。
4. **客户端拆模块**：先拆 audio/feedback/overlay/hud（纯 UI，风险最低），
   再拆 render/scene，最后收敛 replica 状态机（风险最高，放最后）。
5. **每步完成验证**：`pnpm test`（app 内 vitest）+ `pnpm room:dev room-dart-roulette`
   启动无报错 + `build:room` 成功（见 docs/room-dev-harness.md），
   关键步骤后人工联机试玩一局。
6. **文档回写**：行为或结构有变时更新本目录三篇文档与根 AGENTS.md 相关条目。

## 7. 明确不做的事（与仓库约定对齐）

- 不做 room-data 版本迁移/兼容层（schema 只标识当前形状）。
- 不为 UI/渲染/动画/网络时序补自动化测试；集成行为以人工试玩为权威验证。
- 第一轮不改玩法数值、不加新事件类型、不引入防作弊升级（仅记录决策）。
