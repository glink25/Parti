# GameRuntime 设计方案：本地优先、即时同步、低延迟多人游戏运行时

## 0. 设计目标

本文设计一套通用的 `GameRuntime` 系统，用于开发本地优先、即时反馈、轻量同步的多人游戏。

它适用于：

```text id="q24vq8"
聚会小游戏
多人合作 PVE
轻量动作游戏
实时互动房间
多人创作房间
轻量桌游 / 卡牌 / 答题游戏
WebRTC / Socket / 局域网多人游戏
```

它不追求：

```text id="cx8r6r"
竞技级反作弊
严格服务器权威
完全确定性同步
复杂回滚
每一帧强一致
```

它追求：

```text id="m5b45y"
玩家本地操作立即反馈
远端玩家尽快看到近似一致的结果
关键状态最终收敛
游戏逻辑尽量像单机一样编写
同步机制自动接入游戏行为
```

核心原则是：

```text id="xj76cw"
游戏逻辑只写一次。
本地调用它。
远端回放它。
房主兜底它。
```

---

# 1. 核心理念

## 1.1 本地优先

本地优先意味着：

```text id="q1ynm8"
玩家按下移动键，角色立即移动。
玩家点击施法，技能立即释放。
玩家命中怪物，立即显示伤害和反馈。
```

而不是：

```text id="c20ivg"
等待网络确认
等待服务器返回
等待房主批准
然后才播放结果
```

本地优先的体验目标是：

```text id="sp36i2"
先保证手感，再通过同步机制让其他人追上。
```

---

## 1.2 近似同步，而不是严格同步

对于聚会小游戏和轻量多人游戏来说，短时间不一致是可以接受的。

例如：

```text id="yyc7ew"
A 本地看到怪物血量剩余 71。
B 本地看到怪物血量剩余 69。
房主下一次快照确认血量为 68。
两个客户端都修正到 68。
```

这种误差只要不影响核心体验，就是可以接受的。

真正需要最终一致的是：

```text id="n5xvvz"
谁死了
谁活着
怪物是否被击杀
墙是否存在
道具是否被拾取
游戏是否结束
当前分数是多少
```

不需要严格一致的是：

```text id="a40qpd"
粒子效果
伤害数字位置
音效播放时间
远端玩家的插值位置
法球飞行中的每一帧坐标
```

---

## 1.3 同步“行为原因”，而不是同步“表现结果”

不要同步：

```text id="e0p24b"
播放火球动画
播放雷电特效
显示 28 点伤害数字
```

应该同步：

```text id="c826od"
玩家 p1 在位置 x,y 向方向 d 释放了火球。
火球命中了 monster_3。
monster_3 受到一次 fire 类型命中。
```

表现结果由本地系统派生。

也就是：

```text id="qah5z4"
同步 Action
本地生成 Entity
本地运行 System
本地派生 Event
本地渲染表现
```

---

# 2. GameRuntime 的定位

`GameRuntime` 是整个游戏的统一运行时。

它负责承载：

```text id="sqx8u2"
World / Entity / Component
ActionRegistry
StateStore / StateAdapter
EventBus
GameSystems
Render / FX / UI 事件
Plugin System
SyncPlugin
```

游戏开发者不直接调用网络接口，而是调用：

```ts id="as6uhf"
game.action("player.castSpell", payload);
game.state.set("players.p1.position", position);
game.events.emit("fx.spellCast", payload);
```

同步机制不是游戏入口。
同步机制只是 `GameRuntime` 的插件。

---

# 3. 总体架构

推荐整体结构：

```text id="a9sl3y"
GameRuntime
  ├─ World
  │   ├─ Entity
  │   └─ Component
  │
  ├─ ActionRegistry
  │   ├─ defineAction
  │   ├─ dispatch
  │   └─ action policies
  │
  ├─ StateStore
  │   ├─ set
  │   ├─ get
  │   ├─ patch
  │   └─ path bindings
  │
  ├─ EventBus
  │   ├─ emit
  │   └─ on
  │
  ├─ Systems
  │   ├─ MovementSystem
  │   ├─ CollisionSystem
  │   ├─ CombatSystem
  │   ├─ ElementReactionSystem
  │   ├─ LifetimeSystem
  │   └─ RenderSystem
  │
  └─ Plugins
      ├─ LocalFirstSyncPlugin
      ├─ HostSnapshotPlugin
      ├─ PresencePlugin
      └─ DebugPlugin
```

运行链路：

```text id="yyq9u5"
Input / AI / Collision
  ↓
game.action(...)
  ↓
Action Handler
  ↓
World / Components / Systems
  ↓
EventBus
  ↓
Render / FX / UI

SyncPlugin
  旁路监听 Action / State
  自动广播 / 回放 / 兜底
```

---

# 4. 最重要的抽象：Action / State / Event

`GameRuntime` 中所有多人同步都围绕三种对象展开：

```text id="i8j88i"
Action：改变游戏世界的行为
State：需要共享或兜底的状态
Event：本地表现事件
```

---

## 4.1 Action：改变世界的行为

Action 是游戏行为的统一入口。

例如：

```text id="uw3pkx"
player.moveInput
player.castSpell
combat.applyHit
entity.destroy
obstacle.spawn
monster.castSpell
loot.pickup
game.start
game.end
```

所有会改变游戏世界的操作都应该走 Action。

不要直接：

```ts id="vs25eo"
monster.hp -= 20;
```

而是：

```ts id="w02dfo"
game.action("combat.applyHit", {
  targetId: monster.id,
  damage: 20,
});
```

Action 的价值是：

```text id="o7wpgz"
本地可以执行
远端可以回放
房主可以兜底
日志可以记录
录像可以重放
调试可以追踪
```

---

## 4.2 State：当前世界事实

State 用于描述需要共享或兜底的长期状态。

例如：

```text id="zx8i6w"
players.p1.position
players.p1.hp
players.p1.statuses
monsters.m1.hp
monsters.m1.position
obstacles.wall_1.alive
world.phase
world.score
```

State 不适合表达“发生了什么”。
State 适合表达“现在是什么”。

例如：

```text id="h7x0mn"
Action：player.castSpell
State：players.p1.position
Event：fx.spellCast
```

---

## 4.3 Event：本地表现事件

Event 用于驱动表现层。

例如：

```text id="ghg43x"
fx.spellCast
fx.hit
fx.reaction
fx.damageNumber
audio.play
ui.hpChanged
camera.shake
```

Event 默认不需要同步。

因为远端玩家收到同一个 Action 后，会本地派生出相同或近似的 Event。

---

# 5. GameRuntime 核心接口

## 5.1 GameRuntime

```ts id="k76num"
interface GameRuntime {
  readonly playerId: string;
  readonly isHost: boolean;

  world: World;
  actions: ActionRegistry;
  state: GameStateStore;
  events: EventBus;
  systems: GameSystem[];
  plugins: GamePlugin[];

  action<T>(type: string, payload: T): void;
  update(dt: number): void;
  render?(): void;
}
```

最常用的入口是：

```ts id="dsbdta"
game.action("player.castSpell", payload);
```

这个调用会：

```text id="xmhn52"
执行本地 Action Handler
改变 World
触发 Event
让 SyncPlugin 自动处理同步
```

---

## 5.2 World / Entity / Component

```ts id="ybgdpn"
interface World {
  spawn(entity: EntityCreateOptions): EntityId;
  destroy(entityId: EntityId): void;

  getComponent<T>(entityId: EntityId, name: string): T | undefined;
  setComponent<T>(entityId: EntityId, name: string, value: T): void;
  patchComponent<T>(entityId: EntityId, name: string, patch: Partial<T>): void;

  entitiesWith(...components: string[]): EntityId[];
}
```

Entity 不应该靠继承表达能力，而应该靠组件组合。

例如玩家：

```text id="jey13s"
Transform
Velocity
Collider
Health
ElementState
SpellCaster
Owner
Renderable
```

怪物：

```text id="bxslem"
Transform
Velocity
Collider
Health
ElementState
AI
HitSource
Owner
Renderable
```

墙体：

```text id="nvlhph"
Transform
Collider
Health
ElementState
Obstacle
Owner
Renderable
```

法球：

```text id="e6r8qy"
Transform
Velocity
Collider
HitSource
Lifetime
Owner
Renderable
```

毒雾：

```text id="yp0f0v"
Transform
AreaCollider
HitSource
Lifetime
ElementAura
Owner
Renderable
```

这样角色、怪物、墙、陷阱、法球、区域都可以使用同一套系统。

---

## 5.3 ActionRegistry

```ts id="3t7f3s"
interface ActionRegistry {
  define<T>(
    type: string,
    config: ActionConfig,
    handler: ActionHandler<T>,
  ): void;

  dispatch<T>(
    type: string,
    payload: T,
    meta?: Partial<ActionMeta>,
  ): void;

  onAfterDispatch(listener: (action: GameAction) => void): void;
  getPolicy(type: string): ActionSyncPolicy | undefined;
}
```

Action Handler：

```ts id="i4q55b"
type ActionHandler<T> = (
  ctx: ActionContext,
  payload: T,
  action: GameAction<T>,
) => void;
```

ActionContext：

```ts id="kefoch"
interface ActionContext {
  game: GameRuntime;
  world: World;
  state: GameStateStore;
  events: EventBus;
  playerId: string;
  isHost: boolean;
}
```

---

## 5.4 GameAction

```ts id="sc91j2"
interface GameAction<T = unknown> {
  id: string;
  type: string;
  payload: T;

  from: string;
  seq: number;
  roomId?: string;

  origin: "local" | "remote" | "host" | "replay";
  createdAt: number;
}
```

Action 必须满足：

```text id="bls6v4"
payload 可序列化
handler 可幂等
handler 不依赖网络
handler 不区分本地和远端逻辑
```

---

## 5.5 StateStore

```ts id="7dkow5"
interface GameStateStore {
  get<T>(path: string): T | undefined;
  set<T>(path: string, value: T): void;
  patch(patch: StatePatch): void;

  define(pathPattern: string, config: StateSyncConfig): void;
  onChange(listener: (patch: StatePatch) => void): void;
}
```

StatePatch：

```ts id="wva1i6"
interface StatePatch {
  path: string;
  value: unknown;
  version?: number;
  from?: string;
  apply?: "replace" | "smooth" | "merge" | "ignoreIfLocalOwner";
}
```

StateStore 不一定是独立 JSON 数据。
它可以通过 `StateAdapter` 映射回 `World`。

例如：

```text id="f273pi"
players.p1.hp
  ↓
world.getComponent("p1", "Health").current
```

---

## 5.6 EventBus

```ts id="p1fwik"
interface EventBus {
  emit<T>(type: string, payload: T): void;
  on<T>(type: string, handler: (payload: T) => void): void;
}
```

Event 默认只本地消费。

例如：

```ts id="od2t13"
game.events.on("fx.spellCast", payload => {
  fx.spawnSpellCastParticles(payload);
  audio.play("spell_cast");
});
```

---

# 6. 同步策略设计

同步策略不直接写在网络层，而是声明在 Action 和 State 上。

---

## 6.1 Action 同步模式

```ts id="fk2cwr"
type ActionSyncMode =
  | "localOnly"
  | "optimisticBroadcast"
  | "hostRelay"
  | "hostAuthoritative";
```

---

## localOnly

只本地执行，不同步。

适合：

```text id="u6dovy"
镜头震动
本地 UI
本地音效
调试动作
纯表现动画
```

示例：

```ts id="a0l30h"
game.actions.define("camera.shake", {
  sync: {
    mode: "localOnly",
  },
}, (ctx, payload) => {
  ctx.game.camera.shake(payload.intensity);
});
```

---

## optimisticBroadcast

本地立即执行，同时广播给其他玩家。

适合：

```text id="mt7kfc"
移动输入
跳跃
施法
攻击
表情
放置临时技能
互动表现
```

流程：

```text id="vsj7m8"
本地调用 game.action
  ↓
立即执行 Action Handler
  ↓
SyncPlugin 自动广播
  ↓
远端回放同一个 Action Handler
```

示例：

```ts id="lfol2l"
game.actions.define("player.castSpell", {
  sync: {
    mode: "optimisticBroadcast",
    reliable: true,
  },
}, handler);
```

---

## hostRelay

本地立即预测执行，同时发送给房主，房主负责最终兜底。

适合：

```text id="k5ymg6"
命中
扣血
元素状态变化
拾取道具
墙体摧毁
怪物死亡
分数增加
```

流程：

```text id="gn7icj"
本地立即执行
  ↓
发送给房主
  ↓
房主执行或记录
  ↓
房主通过 Result Action / Snapshot 兜底
```

示例：

```ts id="gp1cvg"
game.actions.define("combat.applyHit", {
  sync: {
    mode: "hostRelay",
    reliable: true,
    local: "immediate",
  },
}, handler);
```

---

## hostAuthoritative

只有房主真正执行。

适合：

```text id="rlvsvt"
开始游戏
结束游戏
刷怪
Boss 切阶段
掉落生成
胜负结算
怪物 AI 决策
```

流程：

```text id="msi997"
普通玩家请求
  ↓
runtime 转发给房主
  ↓
房主执行
  ↓
房主广播结果
```

示例：

```ts id="troepo"
game.actions.define("game.start", {
  sync: {
    mode: "hostAuthoritative",
    reliable: true,
  },
}, handler);
```

---

## 6.2 State 同步模式

```ts id="9xno40"
type StateSyncMode =
  | "ownerInterval"
  | "hostInterval"
  | "manualSnapshot"
  | "presence";
```

---

## ownerInterval

由状态拥有者定期同步。

适合：

```text id="q3vodh"
玩家位置
玩家朝向
瞄准方向
当前动画
当前选择元素
```

示例：

```ts id="dqq5wd"
game.state.define("players.*.position", {
  sync: {
    mode: "ownerInterval",
    intervalMs: 80,
    remoteApply: "smooth",
  },
});
```

---

## hostInterval

由房主定期同步。

适合：

```text id="oauci1"
怪物血量
怪物位置
怪物状态
玩家血量
墙体血量
世界阶段
分数
Boss 阶段
```

示例：

```ts id="1zjmsv"
game.state.define("monsters.*.hp", {
  sync: {
    mode: "hostInterval",
    intervalMs: 300,
    remoteApply: "replace",
  },
});
```

---

## manualSnapshot

由游戏在关键时刻主动发送完整快照。

适合：

```text id="kp10ty"
玩家重连
切换关卡
Boss 阶段切换
大量实体刷新
回合开始
回合结束
```

---

## presence

玩家在线和临时信息。

适合：

```text id="v46m4o"
昵称
头像
准备状态
光标
延迟
队伍
选择角色
```

---

# 7. 一致性等级

为了降低延迟，所有数据不应该使用同一种同步要求。

推荐分成五级。

---

## Level 0：本地表现

不同步。

```text id="f0im1o"
粒子
音效
伤害数字
震屏
按钮动画
```

策略：

```text id="fhmf68"
Event / localOnly
```

---

## Level 1：软同步状态

允许误差。

```text id="dwz4oy"
玩家位置
瞄准方向
光标
动画状态
```

策略：

```text id="13rkv0"
ownerInterval + smooth
```

---

## Level 2：操作事件

必须让别人知道发生过，但不需要绝对权威。

```text id="i06yb2"
跳跃
攻击
施法
发射子弹
放置区域
```

策略：

```text id="tbf1wq"
optimisticBroadcast
```

---

## Level 3：关键结果

可以本地预测，但最终要收敛。

```text id="idflpf"
血量
死亡
元素状态
道具归属
墙体是否存在
分数
```

策略：

```text id="an48u6"
hostRelay + hostInterval snapshot
```

---

## Level 4：严格结果

必须由房主决定。

```text id="hm7mb9"
开始游戏
结束游戏
刷怪
掉落
胜负
Boss 阶段
```

策略：

```text id="tz60z7"
hostAuthoritative
```

---

# 8. Plugin 机制

`GameRuntime` 应该支持插件。

```ts id="x8mhri"
interface GamePlugin {
  name: string;
  install(game: GameRuntime): void;
}
```

同步插件就是普通插件。

---

## 8.1 LocalFirstSyncPlugin

职责：

```text id="s72k9j"
监听本地 Action
按策略广播 / 发给房主
接收远端 Action
回放到 ActionRegistry
监听 State Patch
按策略同步状态
接收远端 State Patch
通过 StateAdapter 写回 World
处理 Host Snapshot
```

伪代码：

```ts id="1s5bw4"
class LocalFirstSyncPlugin implements GamePlugin {
  name = "local-first-sync";

  install(game: GameRuntime) {
    game.actions.onAfterDispatch((action) => {
      if (action.origin === "remote") return;

      const policy = game.actions.getPolicy(action.type);
      if (!policy) return;

      if (policy.mode === "optimisticBroadcast") {
        this.transport.broadcast({
          kind: "action",
          action,
        });
      }

      if (policy.mode === "hostRelay") {
        this.transport.sendToHost({
          kind: "action",
          action,
        });
      }

      if (policy.mode === "hostAuthoritative") {
        if (game.isHost) {
          this.transport.broadcast({
            kind: "action",
            action: {
              ...action,
              origin: "host",
            },
          });
        } else {
          this.transport.sendToHost({
            kind: "action",
            action,
          });
        }
      }
    });

    this.transport.onAction((action) => {
      game.actions.dispatch(action.type, action.payload, {
        origin: "remote",
        actionId: action.id,
        from: action.from,
      });
    });

    game.state.onChange((patch) => {
      this.handleLocalStatePatch(game, patch);
    });

    this.transport.onStatePatch((patch) => {
      game.state.patch(patch);
    });
  }
}
```

---

## 8.2 SyncPlugin 不应该做什么

同步插件不应该：

```text id="pm60xn"
计算技能伤害
判断元素反应
直接播放动画
直接修改怪物血量
直接调用渲染器
直接处理碰撞
```

同步插件只负责：

```text id="47zxo6"
把 Action 传给其他客户端
把远端 Action 交还给 GameRuntime
把 State Patch 写回 StateStore
把 Snapshot 写回 World
```

---

# 9. StateAdapter：让 State Patch 真正影响游戏

State 不是一个孤立 JSON 对象。
State Patch 必须能映射回游戏世界。

例如：

```text id="vz36um"
monsters.boss_001.hp = 2130
```

应该写回：

```text id="ltmwj6"
world.getComponent("boss_001", "Health").current = 2130
```

可以设计：

```ts id="1mcu5j"
interface StateAdapter {
  get(path: string): unknown;
  set(path: string, value: unknown, options?: StateApplyOptions): void;
}
```

示例：

```ts id="8f3ivx"
const stateAdapter: StateAdapter = {
  get(path) {
    return readFromWorld(game.world, path);
  },

  set(path, value, options) {
    writeToWorld(game.world, path, value, options);
  },
};
```

写回逻辑：

```ts id="sihjy7"
function writeToWorld(
  world: World,
  path: string,
  value: unknown,
  options?: StateApplyOptions,
) {
  const parts = path.split(".");

  if (parts[0] === "players" && parts[2] === "position") {
    const playerId = parts[1];

    if (options?.remoteApply === "smooth") {
      world.setComponent(playerId, "RemoteTransformTarget", {
        position: value as Vec2,
      });
    } else {
      world.patchComponent(playerId, "Transform", {
        position: value as Vec2,
      });
    }
  }

  if (parts[0] === "monsters" && parts[2] === "hp") {
    const monsterId = parts[1];

    world.patchComponent(monsterId, "Health", {
      current: value as number,
    });

    game.events.emit("ui.hpChanged", {
      entityId: monsterId,
      hp: value,
    });
  }
}
```

这样，远端同步过来的状态才能真正影响游戏内部机制和渲染。

---

# 10. Systems：游戏逻辑仍然本地运行

`GameRuntime` 的核心仍然是本地游戏循环。

```ts id="q81nq4"
class GameRuntimeImpl implements GameRuntime {
  update(dt: number) {
    for (const system of this.systems) {
      system.update(this, dt);
    }
  }
}
```

系统示例：

```text id="fk0ww7"
InputSystem
MovementSystem
RemoteInterpolationSystem
ProjectileSystem
BeamSystem
ZoneSystem
CollisionSystem
CombatSystem
ElementStateSystem
ElementReactionSystem
LifetimeSystem
RenderSystem
```

同步机制不会替代这些系统。

它只负责让不同客户端运行类似的 Action 和接收关键状态纠正。

---

# 11. Render / FX 与同步解耦

渲染系统不监听网络。

渲染系统只看：

```text id="r5b7l1"
World 中的 Entity / Component
EventBus 中的 FX Event
```

例如法球实体：

```ts id="wo0coi"
world.spawn({
  id: "p1:spell:001",
  type: "spell.projectile",
  components: {
    Transform: {...},
    Renderable: {
      prefab: "water_lightning_projectile",
    },
  },
});
```

RenderSystem：

```ts id="qb9bw6"
class RenderSystem {
  render(game: GameRuntime) {
    for (const entity of game.world.entitiesWith("Transform", "Renderable")) {
      const transform = game.world.getComponent(entity, "Transform");
      const renderable = game.world.getComponent(entity, "Renderable");

      game.renderer.draw(renderable.prefab, {
        position: transform.position,
        rotation: transform.rotation,
      });
    }
  }
}
```

远端玩家释放技能时：

```text id="ntlqwt"
远端 Action 回放
  ↓
Action Handler 生成 spell entity
  ↓
RenderSystem 自然绘制 spell entity
```

没有任何网络渲染特殊逻辑。

---

# 12. 完整示例：多人元素释放游戏

下面用一个复杂的元素联机 Demo 说明 `GameRuntime` 如何组织。

游戏支持：

```text id="n14hkp"
7 种元素：火、水、雷、冰、毒、土、风
多种释放形态：法球、射线、AOE、持续区域、墙、陷阱
玩家和怪物共享伤害、Buff、元素反应
墙体是不会移动和攻击的 Entity，也有 Health 和 ElementState
```

---

## 12.1 游戏实体

玩家：

```text id="c63cfe"
Transform
Velocity
Collider
Health
ElementState
SpellCaster
Owner
Renderable
```

怪物：

```text id="9kayz5"
Transform
Velocity
Collider
Health
ElementState
AI
Owner
Renderable
```

法球：

```text id="eg4751"
Transform
Velocity
Collider
HitSource
Lifetime
Owner
Renderable
```

射线：

```text id="rqozp5"
Transform
Beam
HitSource
Lifetime
Owner
Renderable
```

毒雾：

```text id="c95q2w"
Transform
AreaCollider
HitSource
ElementAura
Lifetime
Owner
Renderable
```

召唤墙：

```text id="om2yz3"
Transform
Collider
Health
ElementState
Obstacle
Owner
Renderable
```

---

## 12.2 同步规则

```ts id="jgb87a"
const syncRules = {
  actions: {
    "game.start": {
      mode: "hostAuthoritative",
    },

    "player.moveInput": {
      mode: "optimisticBroadcast",
      reliable: false,
      rateLimitMs: 50,
    },

    "player.selectElements": {
      mode: "optimisticBroadcast",
      reliable: true,
    },

    "player.castSpell": {
      mode: "optimisticBroadcast",
      reliable: true,
    },

    "combat.applyHit": {
      mode: "hostRelay",
      reliable: true,
      local: "immediate",
    },

    "element.ignitePoisonCloud": {
      mode: "hostRelay",
      reliable: true,
      local: "immediate",
    },

    "entity.destroy": {
      mode: "hostRelay",
      reliable: true,
    },

    "monster.spawn": {
      mode: "hostAuthoritative",
      reliable: true,
    },

    "monster.castSpell": {
      mode: "hostAuthoritative",
      reliable: true,
    },

    "loot.pickup": {
      mode: "hostRelay",
      reliable: true,
    },
  },

  states: {
    "players.*.position": {
      mode: "ownerInterval",
      intervalMs: 80,
      remoteApply: "smooth",
    },

    "players.*.facing": {
      mode: "ownerInterval",
      intervalMs: 80,
      remoteApply: "replace",
    },

    "players.*.hp": {
      mode: "hostInterval",
      intervalMs: 300,
      remoteApply: "replace",
    },

    "players.*.statuses": {
      mode: "hostInterval",
      intervalMs: 300,
      remoteApply: "replace",
    },

    "monsters.*.position": {
      mode: "hostInterval",
      intervalMs: 120,
      remoteApply: "smooth",
    },

    "monsters.*.hp": {
      mode: "hostInterval",
      intervalMs: 300,
      remoteApply: "replace",
    },

    "monsters.*.statuses": {
      mode: "hostInterval",
      intervalMs: 300,
      remoteApply: "replace",
    },

    "obstacles.*.hp": {
      mode: "hostInterval",
      intervalMs: 300,
      remoteApply: "replace",
    },

    "obstacles.*.alive": {
      mode: "hostInterval",
      intervalMs: 300,
      remoteApply: "replace",
    },

    "world.phase": {
      mode: "hostInterval",
      intervalMs: 500,
      remoteApply: "replace",
    },
  },
};
```

---

# 13. 玩家释放技能的完整链路

以“水 + 雷法球”为例。

---

## 13.1 输入层

玩家点击释放按钮：

```ts id="vtb2wk"
function onCastButtonPressed() {
  const player = game.world.getLocalPlayer();

  game.action("player.castSpell", {
    playerId: player.id,
    spellId: game.ids.create("spell"),
    elements: ["water", "lightning"],
    delivery: "projectile",
    position: player.castOrigin,
    direction: player.aimDirection,
    power: 1.2,
    seed: game.random.seed(),
  });
}
```

输入层只负责表达意图：

```text id="j2707j"
我要释放一个水雷法球。
```

---

## 13.2 player.castSpell Action

```ts id="ds8zky"
game.actions.define("player.castSpell", {
  sync: {
    mode: "optimisticBroadcast",
    reliable: true,
  },
}, (ctx, payload: CastSpellPayload) => {
  const spell = ctx.game.spellBuildSystem.build({
    elements: payload.elements,
    delivery: payload.delivery,
    power: payload.power,
    seed: payload.seed,
  });

  ctx.game.spellSpawnSystem.spawn({
    spellId: payload.spellId,
    ownerId: payload.playerId,
    spell,
    position: payload.position,
    direction: payload.direction,
  });

  ctx.events.emit("fx.spellCast", {
    playerId: payload.playerId,
    spellId: payload.spellId,
    elements: payload.elements,
    delivery: payload.delivery,
    position: payload.position,
    direction: payload.direction,
  });

  ctx.events.emit("audio.play", {
    name: "spell_cast",
    position: payload.position,
  });
});
```

本地立即：

```text id="g6c7gm"
构建技能
生成法球 Entity
播放施法特效
播放音效
```

同步插件自动：

```text id="gvawix"
广播 player.castSpell
远端回放同一个 handler
远端也生成同一个法球 Entity
```

---

## 13.3 SpellBuildSystem

```ts id="esf4pd"
class SpellBuildSystem {
  build(input: {
    elements: Element[];
    delivery: DeliveryType;
    power: number;
    seed: number;
  }): BuiltSpell {
    const payload = this.buildElementPayload(input.elements, input.power);
    const shape = this.buildDeliveryShape(input.delivery, input.elements);

    return {
      elements: input.elements,
      delivery: input.delivery,
      damage: payload.damage,
      statuses: payload.statuses,
      speed: shape.speed,
      radius: shape.radius,
      durationMs: shape.durationMs,
      hitIntervalMs: shape.hitIntervalMs,
      seed: input.seed,
    };
  }
}
```

水雷法球可能构建为：

```ts id="naxgy2"
{
  elements: ["water", "lightning"],
  delivery: "projectile",
  damage: {
    water: 10,
    lightning: 24,
  },
  statuses: {
    wet: 35,
    shocked: 20,
  },
  speed: 420,
  radius: 18,
  durationMs: 3000,
}
```

---

## 13.4 SpellSpawnSystem

```ts id="f87704"
class SpellSpawnSystem {
  spawn(input: {
    spellId: string;
    ownerId: string;
    spell: BuiltSpell;
    position: Vec2;
    direction: Vec2;
  }) {
    return this.world.spawn({
      id: input.spellId,
      type: "spell.projectile",
      components: {
        Transform: {
          position: input.position,
          rotation: angleOf(input.direction),
        },

        Velocity: {
          value: mul(input.direction, input.spell.speed),
        },

        Collider: {
          shape: "circle",
          radius: input.spell.radius,
        },

        HitSource: {
          ownerId: input.ownerId,
          elements: input.spell.elements,
          damage: input.spell.damage,
          statuses: input.spell.statuses,
          delivery: input.spell.delivery,
          destroyOnHit: true,
        },

        Lifetime: {
          remainingMs: input.spell.durationMs,
        },

        Renderable: {
          prefab: "water_lightning_projectile",
        },
      },
    });
  }
}
```

此时法球只是一个普通 Entity。

它后续由本地系统处理。

---

# 14. 法球飞行、碰撞、命中

## 14.1 MovementSystem

```ts id="azz73u"
class MovementSystem implements GameSystem {
  update(game: GameRuntime, dt: number) {
    for (const entity of game.world.entitiesWith("Transform", "Velocity")) {
      const transform = game.world.getComponent(entity, "Transform");
      const velocity = game.world.getComponent(entity, "Velocity");

      transform.position.x += velocity.value.x * dt;
      transform.position.y += velocity.value.y * dt;
    }
  }
}
```

同步层不参与法球每一帧移动。

---

## 14.2 CollisionSystem

```ts id="ylry6d"
class CollisionSystem implements GameSystem {
  update(game: GameRuntime, dt: number) {
    const collisions = game.physics.detectCollisions();

    for (const collision of collisions) {
      const hitSource = game.world.getComponent<HitSource>(
        collision.sourceId,
        "HitSource",
      );

      if (!hitSource) continue;

      game.action("combat.applyHit", {
        hitId: game.ids.create("hit"),
        sourceId: collision.sourceId,
        ownerId: hitSource.ownerId,
        targetId: collision.targetId,
        hitPoint: collision.point,
        elements: hitSource.elements,
        damage: hitSource.damage,
        statuses: hitSource.statuses,
        delivery: hitSource.delivery,
      });

      if (hitSource.destroyOnHit) {
        game.action("entity.destroy", {
          entityId: collision.sourceId,
          reason: "hit",
        });
      }
    }
  }
}
```

碰撞系统只发现命中，不直接扣血。

命中本身也是 Action，因此可以同步和兜底。

---

## 14.3 combat.applyHit

```ts id="joqmtz"
game.actions.define("combat.applyHit", {
  sync: {
    mode: "hostRelay",
    reliable: true,
    local: "immediate",
  },
}, (ctx, payload: ApplyHitPayload) => {
  const result = ctx.game.combatSystem.resolveHit(payload);

  ctx.game.combatSystem.applyDamage(
    payload.targetId,
    result.damage,
  );

  ctx.game.elementStateSystem.applyChanges(
    payload.targetId,
    result.statusChanges,
  );

  for (const reaction of result.reactions) {
    ctx.game.elementReactionSystem.applyReaction(ctx, reaction);
  }

  ctx.events.emit("combat.hitApplied", {
    hitId: payload.hitId,
    targetId: payload.targetId,
    damage: result.damage,
    reactions: result.reactions,
    hitPoint: payload.hitPoint,
  });

  ctx.events.emit("fx.hit", {
    targetId: payload.targetId,
    elements: payload.elements,
    hitPoint: payload.hitPoint,
  });
});
```

本地立即：

```text id="vcoo4s"
计算伤害
修改 Health
修改 ElementState
触发元素反应
显示伤害数字
播放命中特效
```

同步插件：

```text id="vht2vj"
把 combat.applyHit 发给房主
房主记录或执行
房主通过 Health / ElementState 快照兜底
```

---

# 15. 元素反应系统如何接入同步

元素反应仍然是游戏本地系统，不是同步系统。

```ts id="ohgr60"
class ElementReactionSystem {
  resolve(input: {
    targetId: string;
    incomingElements: Element[];
    currentStatuses: ElementStatus[];
  }): ElementReactionResult[] {
    const results: ElementReactionResult[] = [];

    if (
      input.currentStatuses.includes("wet") &&
      input.incomingElements.includes("lightning")
    ) {
      results.push({
        id: "electrocute",
        bonusDamage: 16,
        addStatuses: ["shocked"],
        chain: {
          radius: 120,
          damage: {
            lightning: 12,
          },
        },
      });
    }

    if (
      input.currentStatuses.includes("wet") &&
      input.incomingElements.includes("fire")
    ) {
      results.push({
        id: "vaporize",
        damageMultiplier: 1.5,
        removeStatuses: ["wet"],
        spawnEntity: {
          type: "steamCloud",
        },
      });
    }

    return results;
  }
}
```

感电连锁：

```ts id="u7xmt7"
class ElementReactionSystem {
  applyElectrocute(ctx: ActionContext, reaction: ElementReactionResult) {
    const nearbyTargets = ctx.game.query.entitiesInRadius(
      reaction.origin,
      reaction.chain.radius,
    );

    for (const target of nearbyTargets) {
      if (!ctx.game.elementStateSystem.hasStatus(target.id, "wet")) {
        continue;
      }

      ctx.game.action("combat.applyHit", {
        hitId: ctx.game.ids.create("hit"),
        sourceId: reaction.sourceId,
        ownerId: reaction.ownerId,
        targetId: target.id,
        hitPoint: target.position,
        elements: ["lightning"],
        damage: reaction.chain.damage,
        statuses: {
          shocked: 20,
        },
        delivery: "chain",
      });
    }

    ctx.events.emit("fx.reaction", {
      reaction: "electrocute",
      position: reaction.origin,
    });
  }
}
```

关键点：

```text id="jfcgqe"
元素反应可以继续触发新的 game.action。
新的 game.action 会继续自动接入同步策略。
```

因此复杂连锁反应不需要手写网络逻辑。

---

# 16. 召唤墙与障碍物

玩家释放土墙：

```ts id="t6o6k3"
game.action("player.castSpell", {
  playerId: "p1",
  spellId: "p1:wall:001",
  elements: ["earth"],
  delivery: "wall",
  position: { x: 500, y: 300 },
  direction: { x: 0, y: 1 },
  power: 1.5,
  seed: 901,
});
```

`player.castSpell` 根据 `delivery: "wall"` 生成墙体 Entity：

```ts id="8g5da7"
world.spawn({
  id: "p1:wall:001",
  type: "obstacle.wall",
  components: {
    Transform: {
      position: payload.position,
      rotation: angleOf(payload.direction),
    },

    Collider: {
      shape: "rect",
      width: 96,
      height: 24,
    },

    Health: {
      current: 180,
      max: 180,
    },

    ElementState: {
      statuses: [],
      buildup: {},
    },

    Obstacle: {
      blocksMovement: true,
      blocksProjectile: true,
      blocksBeam: true,
      blocksVision: false,
    },

    Owner: {
      playerId: payload.playerId,
    },

    Renderable: {
      prefab: "earth_wall",
    },
  },
});
```

之后墙体可以：

```text id="yndzi1"
阻挡移动
阻挡法球
阻挡射线
被攻击扣血
被火元素熔化
被雷元素导电
被毒雾腐蚀
```

它不需要特殊网络逻辑。
因为它和怪物一样拥有：

```text id="bqv8ja"
Health
ElementState
Collider
```

墙体血量和存在状态由房主快照兜底：

```text id="jbt6f8"
obstacles.p1:wall:001.hp
obstacles.p1:wall:001.alive
```

---

# 17. 远端玩家移动

远端玩家移动不应该走本地输入系统。

推荐：

```text id="tzyo9w"
本地玩家：
  InputSystem → MovementSystem → Transform

远端玩家：
  State Patch → RemoteTransformTarget → RemoteInterpolationSystem → Transform
```

本地玩家设置状态：

```ts id="w6d220"
game.state.set(`players.${game.playerId}.position`, player.position);
game.state.set(`players.${game.playerId}.facing`, player.facing);
```

远端收到 patch：

```ts id="4nurx9"
game.state.patch({
  path: "players.alice.position",
  value: { x: 300, y: 120 },
  apply: "smooth",
});
```

StateAdapter 写入：

```ts id="w77hu5"
world.setComponent("alice", "RemoteTransformTarget", {
  position: { x: 300, y: 120 },
});
```

插值系统：

```ts id="tebw1l"
class RemoteInterpolationSystem implements GameSystem {
  update(game: GameRuntime, dt: number) {
    for (const entity of game.world.entitiesWith(
      "Transform",
      "RemoteTransformTarget",
    )) {
      const transform = game.world.getComponent(entity, "Transform");
      const target = game.world.getComponent(entity, "RemoteTransformTarget");

      transform.position = lerp(
        transform.position,
        target.position,
        0.2,
      );
    }
  }
}
```

RenderSystem 只画 `Transform`，因此自然显示远端平滑移动。

---

# 18. Host 快照兜底

房主定期收集关键状态：

```ts id="d5nqyu"
class HostSnapshotPlugin implements GamePlugin {
  install(game: GameRuntime) {
    if (!game.isHost) return;

    setInterval(() => {
      const snapshot = collectSnapshot(game.world, [
        "players.*.hp",
        "players.*.statuses",
        "monsters.*.hp",
        "monsters.*.position",
        "monsters.*.statuses",
        "obstacles.*.hp",
        "obstacles.*.alive",
        "world.phase",
      ]);

      this.transport.broadcast({
        kind: "snapshot",
        snapshot,
      });
    }, 300);
  }
}
```

客户端收到后：

```text id="crljlu"
血量：replace
状态：replace
位置：smooth
墙体存在：replace
世界阶段：replace
```

这样可以保持：

```text id="cbdhtv"
操作本地即时
结果最终收敛
```

---

# 19. 复杂多人战斗流程

场景：

```text id="irlkie"
Alice 使用水雷法球
Bob 使用火风射线
Cathy 使用毒冰区域
Dan 使用土墙防御
Boss 由房主 AI 控制
```

---

## 19.1 Alice 铺水域

```ts id="jj9s03"
game.action("player.castSpell", {
  playerId: "alice",
  spellId: "alice:zone:water:001",
  elements: ["water"],
  delivery: "zone",
  position: { x: 600, y: 300 },
  direction: { x: 0, y: 0 },
  power: 1,
  seed: 1001,
});
```

本地和远端都会生成 `waterZone`。
ZoneSystem 周期性对范围内目标派发：

```ts id="yliyov"
game.action("combat.applyHit", {
  targetId: "boss_001",
  elements: ["water"],
  statuses: {
    wet: 20,
  },
  damage: {
    water: 2,
  },
  delivery: "zone",
});
```

Boss 获得 `wet` 状态。
房主快照兜底：

```text id="rr9h21"
monsters.boss_001.statuses = ["wet"]
```

---

## 19.2 Alice 雷球触发感电

```ts id="jfsx30"
game.action("player.castSpell", {
  playerId: "alice",
  spellId: "alice:projectile:lightning:001",
  elements: ["lightning"],
  delivery: "projectile",
  position: { x: 300, y: 280 },
  direction: { x: 1, y: 0 },
  power: 1.2,
  seed: 1002,
});
```

雷球命中湿润 Boss：

```ts id="guv544"
game.action("combat.applyHit", {
  hitId: "alice:hit:001",
  sourceId: "alice:projectile:lightning:001",
  ownerId: "alice",
  targetId: "boss_001",
  hitPoint: { x: 600, y: 300 },
  elements: ["lightning"],
  damage: {
    lightning: 32,
  },
  statuses: {
    shocked: 30,
  },
  delivery: "projectile",
});
```

CombatSystem 发现：

```text id="tbnjjh"
target has wet
incoming has lightning
```

触发：

```text id="t25s5i"
electrocute
额外雷伤
添加 shocked
连锁附近 wet 目标
```

连锁继续通过 `game.action("combat.applyHit")` 派发。

---

## 19.3 Bob 用火风射线点燃毒雾

Cathy 先释放毒雾：

```ts id="p9tafj"
game.action("player.castSpell", {
  playerId: "cathy",
  spellId: "cathy:zone:poison:001",
  elements: ["poison", "wind"],
  delivery: "zone",
  position: { x: 640, y: 320 },
  direction: { x: 0, y: 0 },
  power: 1.3,
  seed: 2001,
});
```

Bob 火球命中毒雾 Entity：

```ts id="ob6av6"
game.action("element.ignitePoisonCloud", {
  cloudId: "cathy:zone:poison:001",
  igniterId: "bob",
  position: { x: 640, y: 320 },
  radius: 190,
  damage: {
    fire: 60,
    poison: 30,
  },
});
```

Action Handler：

```ts id="n2zaa2"
game.actions.define("element.ignitePoisonCloud", {
  sync: {
    mode: "hostRelay",
    reliable: true,
    local: "immediate",
  },
}, (ctx, payload) => {
  const targets = ctx.game.query.entitiesInRadius(
    payload.position,
    payload.radius,
  );

  for (const target of targets) {
    ctx.game.action("combat.applyHit", {
      hitId: ctx.game.ids.create("hit"),
      sourceId: payload.cloudId,
      ownerId: payload.igniterId,
      targetId: target.id,
      hitPoint: target.position,
      elements: ["fire", "poison"],
      damage: payload.damage,
      statuses: {
        burning: 20,
        poisoned: 20,
      },
      delivery: "aoe",
    });
  }

  ctx.game.action("entity.destroy", {
    entityId: payload.cloudId,
    reason: "reaction",
  });

  ctx.events.emit("fx.poisonExplosion", {
    position: payload.position,
    radius: payload.radius,
  });
});
```

本地立即爆炸。
房主通过 `obstacles / monsters / statuses / hp` 快照兜底最终结果。

---

## 19.4 Dan 召唤土墙阻挡 Boss 射线

Dan：

```ts id="po76vg"
game.action("player.castSpell", {
  playerId: "dan",
  spellId: "dan:wall:001",
  elements: ["earth"],
  delivery: "wall",
  position: { x: 480, y: 300 },
  direction: { x: 0, y: 1 },
  power: 1.5,
  seed: 3001,
});
```

Boss 由房主 AI 释放射线：

```ts id="hdf2h2"
game.action("monster.castSpell", {
  monsterId: "boss_001",
  spellId: "boss:beam:001",
  elements: ["lightning"],
  delivery: "beam",
  position: { x: 610, y: 300 },
  direction: { x: -1, y: 0 },
  power: 1.8,
  seed: 3002,
});
```

BeamSystem 检测射线首先命中土墙：

```ts id="scpgqa"
game.action("combat.applyHit", {
  hitId: "boss:beam:hit:wall",
  sourceId: "boss:beam:001",
  ownerId: "boss_001",
  targetId: "dan:wall:001",
  hitPoint: { x: 480, y: 300 },
  elements: ["lightning"],
  damage: {
    lightning: 60,
  },
  delivery: "beam",
});
```

土墙扣血。
射线被阻挡。
房主兜底墙体血量和 alive 状态。

---

# 20. 代码组织建议

```text id="sbxg39"
src/game/
  runtime/
    GameRuntime.ts
    World.ts
    ActionRegistry.ts
    StateStore.ts
    StateAdapter.ts
    EventBus.ts
    Plugin.ts

  sync/
    LocalFirstSyncPlugin.ts
    HostSnapshotPlugin.ts
    PresencePlugin.ts
    syncRules.ts

  components/
    Transform.ts
    Velocity.ts
    Collider.ts
    Health.ts
    ElementState.ts
    HitSource.ts
    Obstacle.ts
    Lifetime.ts
    Owner.ts
    Renderable.ts
    RemoteTransformTarget.ts

  actions/
    game.start.ts
    player.moveInput.ts
    player.selectElements.ts
    player.castSpell.ts
    combat.applyHit.ts
    element.ignitePoisonCloud.ts
    entity.destroy.ts
    monster.spawn.ts
    monster.castSpell.ts
    loot.pickup.ts

  systems/
    InputSystem.ts
    MovementSystem.ts
    RemoteInterpolationSystem.ts
    SpellBuildSystem.ts
    SpellSpawnSystem.ts
    ProjectileSystem.ts
    BeamSystem.ts
    ZoneSystem.ts
    CollisionSystem.ts
    CombatSystem.ts
    ElementStateSystem.ts
    ElementReactionSystem.ts
    LifetimeSystem.ts
    MonsterAISystem.ts
    RenderSystem.ts

  fx/
    SpellFxSystem.ts
    ReactionFxSystem.ts
    DamageNumberSystem.ts
    AudioSystem.ts

  demo/
    createElementGame.ts
    registerElementActions.ts
    registerElementSystems.ts
    createElementSyncRules.ts
```

---

# 21. 推荐开发流程

## 第一步：先写纯单机 GameRuntime

实现：

```text id="d0csxi"
World
ActionRegistry
EventBus
Systems
RenderSystem
```

让游戏在没有同步插件的情况下可以运行。

---

## 第二步：把所有世界变化改成 Action

例如：

```text id="oyrkgj"
施法 → player.castSpell
命中 → combat.applyHit
销毁 → entity.destroy
拾取 → loot.pickup
开始 → game.start
```

不要在系统里随意直接改关键状态。

---

## 第三步：加 StateAdapter

把这些路径映射到 World：

```text id="m2e93e"
players.*.position
players.*.hp
monsters.*.hp
monsters.*.statuses
obstacles.*.alive
world.phase
```

---

## 第四步：接入 LocalFirstSyncPlugin

给 Action 和 State 添加同步策略。

游戏逻辑不需要重写。

---

## 第五步：加入房主快照兜底

先同步：

```text id="eqrwcu"
hp
statuses
alive
world.phase
```

再同步：

```text id="j7t8bi"
monster position
obstacle hp
loot state
boss phase
```

---

# 22. 设计约束

## 22.1 改变世界必须走 Action

错误：

```ts id="ogrv1z"
entity.health.current -= 10;
```

正确：

```ts id="v8zh0d"
game.action("combat.applyHit", payload);
```

---

## 22.2 Action Payload 必须可序列化

不要传：

```text id="ryr8r4"
函数
DOM
Canvas
class 实例
Map
Set
循环引用
本地对象引用
```

只传：

```text id="bcwqab"
string
number
boolean
array
plain object
null
```

---

## 22.3 网络实体必须有稳定 ID

不要依赖本地对象引用。

推荐：

```ts id="z8jlj4"
spellId = `${playerId}:spell:${seq}`;
wallId = `${playerId}:wall:${seq}`;
hitId = `${playerId}:hit:${seq}`;
```

---

## 22.4 Event 默认不同步

表现由 Action 派生。

---

## 22.5 Host 只兜底关键状态

不要让 Host 接管所有操作。

否则本地优先会退化成高延迟服务器权威。

---

# 23. 最终执行模型

一个本地优先 GameRuntime 的最终模型是：

```text id="pqg9mb"
本地输入
  ↓
game.action(...)
  ↓
本地 Action Handler 立即执行
  ↓
World 改变
  ↓
Systems 继续推进
  ↓
EventBus 触发表现
  ↓
RenderSystem 渲染

同时：

SyncPlugin 监听 Action
  ↓
按策略广播 / 发给房主
  ↓
远端收到后回放同一个 Action
  ↓
远端 World 发生相同类型变化

房主：

定期收集关键 State
  ↓
广播 Snapshot
  ↓
客户端应用 Patch
  ↓
血量 / 状态 / 存活 / 阶段最终收敛
```

---

# 24. 一句话总结

`GameRuntime` 的核心不是“网络同步模块”，而是：

```text id="tvybzs"
一个以 Action 为统一行为入口、
以 World/Component 为游戏状态、
以 System 为本地计算、
以 Event 为表现派生、
以 Plugin 为同步扩展的本地优先多人游戏运行时。
```

它让开发者可以像写单机游戏一样写逻辑：

```ts id="h3er86"
game.action("player.castSpell", payload);
```

但在接入同步插件后，它会自动获得：

```text id="culixz"
本地立即反馈
远端自动回放
状态低频同步
房主最终兜底
关键结果收敛
最大限度降低延迟影响
```
