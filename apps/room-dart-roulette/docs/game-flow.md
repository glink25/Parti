# 游戏流程分析

> 依据：`src/shared.ts`、`src/worker/logic.ts`、`src/worker/index.ts`、`public/parti.room.json`。

## 1. 游戏定位与基本规则

「飞镖轮盘」是 2–8 人回合制派对游戏：

- 中央是一块**永不停转的木质标靶**，玩家头像按座位均匀分布在标靶外圈轨道上。
- 轮到你时，你的飞镖固定从**自己座位方向**射向标靶；你只需按「发射」选择时机。
- 飞镖扎在标靶上的位置由**发射瞬间标靶的转角**决定——瞄准的本质是对旋转提前量的判断。
- 镖与镖**碰撞扣血**，贴着别人的镖落下则**按接近程度得分**；超时未射完也扣血。
- 生命耗尽即淘汰，**最后存活者获胜**。过程中穿插随机轮盘事件改变转速/方向或生成奖惩区域。

## 2. 核心数值常量

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `INITIAL_TURN_MS` | 15 000 | 第 1 轮每回合总时限 |
| `TURN_DECAY_MS` | 2 000 | 每过一整轮回合时限衰减量 |
| `MIN_TURN_MS` | 5 000 | 回合时限下限 |
| `SHOT_FLIGHT_MS` | 520 | 飞镖飞行时长（逻辑时间，非纯动画） |
| `REBASE_MS` | 150 | 客户端重对齐动画时长 |
| `WATCHDOG_MS` | 20 000 | 出手方无响应看门狗 |
| `BASE_ROTATION_MS` | 8 000 | 标靶基础转速：8 秒/圈 |
| `STANDARD_DART_ANGLE` | 0.055 rad | 标准宽度飞镖的角半径（碰撞与计分基准） |
| `ZONE_ARC` | π/5（36°） | 事件奖惩区域的角宽度 |
| 生命值 | 3（`clampHealth` 0–3） | 初始/上限 |
| 人数 | 2–8 | manifest `minPlayers`/`maxPlayers` |

回合时限公式：`max(5000, 15000 − (round−1) × 2000)`（`turnDurationForRound`）。
注意「回合」与「轮」：每个玩家行动一次是一个**回合（turn）**；所有存活玩家都行动过
一次、指针回绕时 **轮（round）+1**，时限随之收紧，并广播 `roulette:round-started`。

## 3. 顶层阶段状态机（`GameState.phase`）

```txt
        start_game（房主，全员已准备，2–8 人）
 lobby ────────────────────────────────────► playing
   ▲                                            │
   │         return_to_lobby（房主）             │ 存活者 ≤ 1（finishIfNeeded）
   └─────────────────────────────────────── finished
```

- **lobby**：玩家加入为 `waiting`，可 `toggle_ready`；房主 `start_game` 洗牌定座位与出手顺序
  （`activeOrder`），重置全部对局数据并进入第一回合。
- **playing**：按 `activeOrder` 循环推进回合，直到存活 ≤ 1 人。
- **finished**：广播 `roulette:game-over`，展示排名（胜者优先，再按分数、安全命中数排序）；
  房主可 `return_to_lobby` 重置大厅（离线玩家此时被清除）。

## 4. 玩家状态（`GamePlayer.status`）

| 状态 | 含义 |
| --- | --- |
| `waiting` | 大厅中（可准备） |
| `queued` | 对局进行中加入/未进首发名单，下局候场 |
| `alive` | 本局存活，参与出手循环 |
| `eliminated` | 生命耗尽淘汰，保留在排名中 |

附加标志：`connected`（playing 中离开不清档，只标记离线）、`ready`（仅大厅）、
`seat`（座位序号，决定出手方向与颜色）、`nextTurnShots` / `nextTurnWidth`
（下回合需射几支、镖宽度，被区域事件修改后生效一次即还原）。

## 5. 回合生命周期

```txt
beginTurn(player)
  │  生成 TurnSnapshot（id=turn-{turnRevision}-{playerId}，required=nextTurnShots，
  │  durationMs=本轮时限，dartWidth=nextTurnWidth，logicalElapsed=0）
  │  广播 roulette:turn-granted；启动/重置看门狗
  ▼
出手方客户端重对齐(REBASE_MS) → 发送 accept_turn ──► Worker 重置看门狗
  ▼
循环 required 次：
  出手方本地仿真 → commit_shot ──► Worker 校验通过 → applyShot
    · 更新镖盘/血量/得分/旋转锚点/logicalElapsed=impactElapsed
    · 广播 roulette:shot-committed（及 zone-triggered / health-changed / player-eliminated）
    · 若玩家被淘汰或 committed ≥ required → advanceTurn
  ▼ （未射完且时限耗尽）
出手方本地判定超时 → commit_timeout ──► applyTimeout
    · 伤害 = required − committed；广播 roulette:timeout / health-changed
  ▼
看门狗触发（20s 无 accept / 无完成）→ applyTimeout(watchdog=true)
  ▼
advanceTurn：rotation 锚点归一到 logicalElapsed 终点 → 若 eventDue 触发随机事件
  → 找下一位 alive 玩家（回绕则 round+1）→ beginTurn
```

关键不变量：

- 同一时刻全局只有一个 `turn`，`turnId/revision` 唯一，任何 commit 都绑定它们，
  过期回合的提交一律拒绝（`STALE_TURN`）。
- `turn.logicalElapsed` 是这条回合时间轴的「已确认进度」：每接受一镖就推进到该镖的
  命中时刻，回合超时点为 `max(durationMs, logicalElapsed)`。
- 多镖回合（`required=3`）共享同一个总时限，不是每支镖单独计时。

## 6. 旋转模型与命中判定

### 6.1 确定性旋转

```ts
Rotation = { anchorAngle, anchorElapsed, speedFactor, direction }
rotationAngleAt(rotation, elapsed) =
  normalize(anchorAngle + (elapsed − anchorElapsed)/8000ms × 2π × speedFactor × direction)
```

转角是「逻辑经过毫秒数」的纯函数。任何状态变化（命中、超时、事件）都把当前转角
重新锚定（re-anchor），再叠加新参数——因此**所有端对任意时刻的转角有唯一共识**，
不需要持续同步角度。

### 6.2 落点

- 出手的世界方向固定为座位方向（`seatWorldAngle`，12 点起按 seat 均分）。
- 命中时刻 `impactElapsed = fireElapsed + 520ms`，落点板面角
  `boardAngle = normalize(worldAngle − rotationAngleAt(rotation, impactElapsed))`。
- 所有钉在板上的镖记录的是**板面角**（随板一起转），渲染时再加当前转角。

### 6.3 碰撞（扣血）

两镖角距 ≤ `0.055 × (wA+wB)/2`（w 为宽度因子）即碰撞：新镖**不钉板、不得分**，
出手方 −1 血。碰撞取距离最近的一支作为目标。

### 6.4 得分（安全命中）

无碰撞时，取与最近**敌方**镖的「边到边间隙 ÷ 0.055」（己方镖不参与计分但参与碰撞）：

| 间隙 | 得分 |
| --- | --- |
| ≤ 0.5 | 100 |
| ≤ 1.5 | 60 |
| ≤ 3 | 30 |
| > 3（含板上无敌方镖） | 10 |

即鼓励贴镖：贴得越险分越高，贴上就是碰撞扣血。

### 6.5 区域事件判定

命中落在事件区域（`zoneAngle ± ZONE_ARC/2`，边界含端点）且无碰撞时触发区域效果。

## 7. 随机事件系统

- 触发节奏：每接受一镖 `shotsSinceEvent + 1`；达到 `nextEventAt`（3–5 的随机整数）时
  置 `eventDue`，**在下一回合开始前的 advanceTurn 里**触发（不打断进行中的回合）。
- 触发时先按事件重置旋转锚点与速度/方向，再（若是区域事件）用 `pickZoneAngle`
  在 16 个采样候选中选离现有镖最远的区域中心。连续两次不会出同一事件。
- 事件通过 `state.event` 持久（新加入者可见），并广播 `roulette:event` 做提示。

| kind | 文案 | 效果 |
| --- | --- | --- |
| `speed_up` | 烈酒加速 | 转速 ×1.5（持续到下个事件） |
| `reverse` | 酒馆反转 | 反向旋转（持续到下个事件） |
| `heal_zone` | 暖炉祝福 | 命中区域 +1 血（上限 3） |
| `slow_zone` | 冰镇时刻 | 命中后转速 ×0.7 且方向归正（`rotationAfter` 体现，持续到下个事件） |
| `wide_zone` | 笨重镖区 | 命中者下回合镖宽 ×1.5（更易碰撞也更容易得分的双面效果） |
| `multishot_zone` | 三镖罚单 | 命中者下回合须在**同一总时限内**射 3 支 |

区域效果直接改写玩家 `nextTurnShots` / `nextTurnWidth`，`beginTurn` 消费后还原为 1。
`slow` 的减速写入该镖的 `rotationAfter`，由 Worker 校验（`speedFactor===0.7 && direction===1`）。

## 8. 超时、伤害与淘汰

| 场景 | 伤害 | 说明 |
| --- | --- | --- |
| 回合倒计时耗尽 | `required − committed` | 出手方本地计算并 `commit_timeout` |
| 看门狗（连接无响应） | 同上 | Worker 20s 未收到 accept/完成即强制执行，`watchdog=true` |
| 镖碰撞 | 1 | 立即生效 |

血量到 0 → `eliminated`，广播 `roulette:player-eliminated`；当前回合立即结束并推进。
存活 ≤ 1 → `finished`，广播 `roulette:game-over`（可能无人幸存，`winnerId=null`）。

## 9. 进出与断线语义

- 对局中加入/重连无记录 → 新玩家以 `queued` 进入，下一局参与。
- playing 中离开：保留席位与数据，`connected=false`；离线玩家的回合仍会被推进
  （看门狗/超时机制保证不卡死——这是离线不阻塞对局的关键）。
- lobby/finished 中离开：直接删除。
- 房主刷新：`onRestore` 从快照恢复并重新武装看门狗，对局可继续。

## 10. 计分/排名之外的统计

`stats: { shots, safeHits, collisions, timeouts }` 全程累计，结算页排名用
`score → safeHits` 次序（胜者优先）。当前 UI 只在结算展示分数与名次，统计项未全部外露。
