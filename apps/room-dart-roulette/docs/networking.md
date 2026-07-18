# 联机与延迟处理机制

> 依据：`src/worker/index.ts`（权威端）、`src/shared.ts`（协议函数）、`src/main.ts`（客户端）、
> `docs/worker-api.md`、`docs/client-api.md`。

## 1. 权威模型总览

- 权威 `state` 只在**房主浏览器的 Web Worker** 中；每个输入（join/leave/action/timer）
  处理完后 Runtime 自动把**全量快照**广播给所有玩家（manifest `sync.mode = "snapshot"`）。
- 客户端不做权威判定，只渲染状态 + 提交 action。瞬时表现（飞行动画、提示音、弹窗）走
  `ctx.broadcast` / `ctx.send` 的一次性事件，客户端用 `parti.onEvent` 接收。
- `parti.action()` 的 Promise 只表示「已发出」，成败由后续 `onState` / `onEvent` 体现。

这个游戏的特殊性在于它是**强实时**玩法（判断旋转提前量），不能等服务器回包再出结果。
解决方案是本文档的核心：**逻辑时钟 + 客户端确定性仿真 + 服务端结构校验**。

## 2. 逻辑时钟：让结果与网络延迟无关

### 2.1 时间轴不是墙钟

每个回合是一条**逻辑时间轴**（单位 ms），由权威状态中的锚点描述：

- `Rotation = { anchorAngle, anchorElapsed, speedFactor, direction }`：
  任意逻辑时刻 `elapsed` 的转角是唯一确定的纯函数（见 game-flow.md §6.1）。
- `turn.logicalElapsed`：本回合已被确认的进度（最近一镖的命中时刻）。

关键设计：**逻辑时间只在「被接受的事件」处推进**（镖命中、超时），两次事件之间各端
各自用本地墙钟外推即可，因为外推函数和锚点全网一致。

### 2.2 一镖的时间戳链

出手方按下发射时本地记录：

```txt
windowElapsed = 本地回合窗口内经过的时间（从窗口起点到按下）
fireElapsed   = turn.logicalElapsed + windowElapsed      // 开火点（逻辑时间轴上）
impactElapsed = fireElapsed + SHOT_FLIGHT_MS             // 命中点
```

`simulateShot` 用 `impactElapsed` 算出 `boardAngle`、碰撞、得分、区域效果，以及命中后的
新旋转锚点 `rotationAfter`（`anchorElapsed = impactElapsed`）。**这些全部打包进
`ShotCommit` 提交给 Worker。**

因为 commit 自带在逻辑时间轴上的坐标，**它晚到 200ms 还是 500ms 都无所谓**——Worker
校验的是坐标本身的自洽性，而不是到达时刻。`shared.test.ts` 的
`latency-independent local simulation` 用例固化了这一点。

### 2.3 为什么不需要时钟同步

客户端之间从不互相对时。唯一共享的「现在」是逻辑时间轴上的锚点；每个客户端把
「收到快照的本地时刻」映射为逻辑时间的墙钟起点（`wallEpoch/logicalEpoch`），之后各自
外推。不同客户端的画面可能差几十毫秒，但**结果数据完全一致**——实时性只影响观感，
不影响判定。

## 3. 本地预测（出手方）

出手方客户端维护一个 `LocalReplica`（`main.ts`）：

1. 按下发射 → `simulateShot` 本地算出完整结果，进入 `flying` 阶段，立即播放飞行动画。
2. 520ms 后 `applyLocalShot`：`applyPredictedShot` 把结果应用到本地副本（钉镖、加分、
   扣血、区域效果），**不等 Worker 确认**，同时异步 `parti.action('commit_shot', commit)`。
3. 若 Worker 接受，随后的快照/事件与本地预测天然一致（同一套纯函数算出来的），无感知。
4. 若被拒绝（见 §4），进入 `recovering`：放弃本地预测，以权威快照重建副本并重对齐。

多镖回合：每支镖命中后本地推进 `turn.logicalElapsed = impactElapsed`，窗口重置，
继续下一支，共享同一总时限。

超时同样本地先判：到达时限 → 本地扣血 + `commit_timeout` 提交。

## 4. 服务端校验（`validateShotCommit`）

Worker **不重新仿真**（它无法知道玩家真实的按下时刻），而是对 commit 做严格的
结构/一致性校验。容忍误差统一为 **0.5ms**：

| 校验项 | 拒绝原因 |
| --- | --- |
| 当前回合存在且 phase=playing | `NO_ACTIVE_TURN` |
| 提交者即当前出手方 | `NOT_CURRENT_PLAYER` |
| `turnId`/`revision` 匹配当前回合 | `STALE_TURN` |
| `shotId` 未出现过（幂等去重） | `DUPLICATE` → **静默忽略**，不视为错误 |
| `seq === lastAcceptedSeq + 1`（严格顺序） | `OUT_OF_ORDER` |
| `0 ≤ windowElapsed ≤ durationMs`；`fireElapsed = logicalElapsed + windowElapsed`；`fireElapsed ≤ durationMs + 0.5`；`impactElapsed = fireElapsed + 520` | `BAD_TIMING` |
| `0 ≤ boardAngle < 2π` | `BAD_ANGLE` |
| `widthFactor === turn.dartWidth` | `BAD_WIDTH` |
| `rotationAfter` 锚定于 `impactElapsed`，角度合法；非 slow 情况下速度/方向必须延续当前 rotation；slow 必须恰为 `0.7 / 方向 1` | `BAD_ROTATION` |
| 碰撞目标必须真实存在 | `BAD_COLLISION_TARGET` |
| 碰撞 ⇒ 得分 0 且无区域效果 | `BAD_COLLISION_RESULT` |
| 无碰撞 ⇒ 得分 ∈ {10,30,60,100} | `BAD_SCORE` |
| 区域效果与当前事件类型一致 | `BAD_ZONE_EFFECT` |

处置策略（`commit_shot` handler）：

- `DUPLICATE`：直接 return——网络重发/双击不产生二次效果（幂等）。
- 其他拒绝：`send(playerId, 'roulette:commit-rejected', { turnId, revision, reason, boardRevision })`，
  客户端收到后用 `parti.getState()` 拉最新快照进入 `recovering` 重对齐。

**信任边界须知**：Worker 校验的是「结果自洽且符合规则常量」，但 `boardAngle`、得分档位、
碰撞与否本质上是客户端申报的——恶意客户端可以申报一个合法范围内的最优结果。对派对游戏
这是可接受的权衡（房主即服务器、玩家互为熟人）；重构时若要强化，可让 commit 改报
`windowElapsed`（开火时机）由 Worker 统一算结果，代价是失去「客户端先行展示」的零延迟手感，
或改为双端各算一次比对。当前架构的选择是：**手感优先，校验兜底防呆不防恶意。**

## 5. 回合握手与看门狗

回合是「授予—接受—完成」的三段式：

1. Worker `beginTurn` → 广播 `roulette:turn-granted` + 启动 20s 看门狗。
2. 出手方客户端收到快照后先花 `REBASE_MS`(150ms) 把画面旋转**平滑重对齐**到权威角度
   （`aligning` 阶段），完成后才激活回合并发 `accept_turn`；Worker 收到后重置看门狗。
3. 回合正常完成（射满 / 淘汰 / 超时提交）→ `clearTimer` + `advanceTurn`。
4. 看门狗触发（出手方掉线/卡死，从未 accept 或中途消失）→ Worker 强制执行
   `applyTimeout(watchdog=true)`：按未射支数扣血、推进回合。事件 `roulette:timeout`
   带 `watchdog` 标志区分「连接超时」与「回合超时」。

由此保证：**任何玩家掉线都不会阻塞对局**，最坏情况是每个离线回合付出 20s + 扣血。

`onRestore`（房主刷新恢复）会重新武装看门狗，避免恢复快照后回合永久悬停。

## 6. 重对齐（Rebase）机制

客户端画面转角与权威转角会在以下时刻出现偏差：新回合快照到达、commit 被拒、
断线重连。处理方式是统一的 `beginReplica`：

- 记录当前视觉角 `rebaseFrom` 与权威目标角 `rebaseTo`；
- 用 150ms smoothstep 插值过渡（`aligning` / `recovering` 阶段），期间计时器显示 `···`；
- 过渡结束（`activateReplica`）才把 `wallEpoch` 设为当下，逻辑时钟从
  `turn.logicalElapsed` 继续走。

即「先对齐画面，再启动时钟」，玩家的可感时限不会因对齐动画而缩水。

## 7. 旁观者侧的远程镖呈现

旁观者收到 `roulette:shot-committed` 事件后**不立即钉镖**，而是：

1. 推入 `remoteFlights`，本地播 520ms 飞行动画（起点=出手者座位，终点=commit 里的
   `boardAngle + 当前转角`）；
2. 动画结束才 `completeRemoteFlight`：把镖加入本地副本、采用 commit 的 `rotationAfter`
   与 `impactElapsed` 作为新的本地时钟锚点；
3. 若动画期间来了新快照（其中已包含这支镖），`beginReplica` 用 `deferredDarts`
   把仍在飞的镖从快照里剔除，避免「板上同时出现钉着的镖和飞着的镖」。

事件先行、状态兜底的顺序由 Runtime 保证（同一输入处理中 broadcast 先于快照到达），
客户端仍做了幂等防护（`completeRemoteFlight` 里按 `shotId` 去重）。

## 8. 断线、重连与恢复

| 场景 | Worker 行为 | 客户端行为 |
| --- | --- | --- |
| playing 中掉线 | 保留数据，`connected=false`；回合由看门狗兜底 | 记分牌显示「离线」 |
| 掉线后重连 | `onReconnect` 恢复原身份与席位 | 收到最新快照，`beginReplica` 重对齐继续 |
| 对局中新加入 | `queued`，下局进入 | 旁观 |
| 房主刷新 | `onRestore` 快照水合 + 重新武装看门狗 | — |
| 回大厅 | `return_to_lobby` 清除离线玩家 | — |

## 9. 协议契约清单

### 9.1 Actions（客户端 → Worker）

| Action | Payload | 说明 |
| --- | --- | --- |
| `toggle_ready` | — | 大厅切换准备 |
| `start_game` | — | 房主开局（2–8 人全员 ready） |
| `accept_turn` | `{ turnId, revision }` | 回合握手，重置看门狗 |
| `commit_shot` | `ShotCommit` | 提交一镖的完整结果（含 outcome 与 rotationAfter） |
| `commit_timeout` | `TimeoutCommit` | 提交回合超时（`finalElapsed`、`rotationEndAngle` 需与权威推算一致，容差 0.5ms） |
| `return_to_lobby` | — | 房主在 finished 后重置大厅 |

### 9.2 事件（Worker → 客户端）

| 事件 | 范围 | 时机 |
| --- | --- | --- |
| `roulette:lobby-error` | 单人 | 大厅操作被拒（含 reason 码） |
| `roulette:game-started` | 广播 | 开局，携带出手顺序 |
| `roulette:turn-granted` | 广播 | 新回合生成 |
| `roulette:round-started` | 广播 | 回绕进入新一轮（时限收紧） |
| `roulette:shot-committed` | 广播 | 一镖被接受（旁观者据此播飞行动画） |
| `roulette:commit-rejected` | 单人 | commit 被拒（客户端重同步） |
| `roulette:zone-triggered` | 广播 | 区域效果生效 |
| `roulette:health-changed` | 广播 | 血量变化（collision / zone / turn-timeout / connection-timeout） |
| `roulette:player-eliminated` | 广播 | 淘汰 |
| `roulette:timeout` | 广播 | 回合/看门狗超时结算 |
| `roulette:event` | 广播 | 新随机事件 |
| `roulette:game-over` | 广播 | 对局结束 |

> 注意：以上事件均为「提示性」一次性通知；权威数据永远以 `state` 快照为准
> （事件先于快照到达，但客户端用 `beginReplica`/`deferredDarts` 做了幂等合并）。

### 9.3 State 快照骨架（`schema: 'dart-roulette@2'`）

`phase / hostId / players / activeOrder / currentIndex / turn / rotation / darts /
event / shotsSinceEvent / nextEventAt / eventDue / boardRevision / turnRevision /
winnerId / round`

`boardRevision`、`turnRevision` 单调递增，是客户端检测变化与拒绝过期数据的依据。

## 10. 已知边界与风险（重构时需决策）

1. **防作弊弱**：结果由客户端申报、Worker 只做结构校验（见 §4 信任边界）。
2. **房主单点**：权威在房主浏览器，房主彻底关页则对局无法继续（平台层能力，游戏无法解决）。
3. **旁观者时间轴近似**：远程镖的飞行起点按「收到事件的时刻」起算，晚收到事件的客户端
   看到的锚点切换略晚——观感差异，不影响数据。
4. **0.5ms 容差与 `performance.now()`**：同设备同源时钟下足够；跨端没有时钟比较，容差只用于
   自洽性校验，无副作用。
5. **快照全量广播频率**：每个输入一次全量快照。本游戏状态很小（镖数量线性增长但有限），
   无压力；若重构加入大量装饰性状态需注意体积。
6. **`accept_turn` 无拒绝反馈**：payload 不匹配时静默 return（worker/index.ts:427），
   正常路径无影响，但调试时不可见。
7. **回合时限的视觉误差**：非出手方的倒计时环显示的是静态 `durationMs`（main.ts:553），
   不出手方看到的剩余时间是近似值——属有意简化。
