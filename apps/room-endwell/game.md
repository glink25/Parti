# Endwell 游戏机制设计文档

## 1. 设计目标

`Endwell` 是 `parti` 平台中的一款基于元素组合的 2D 横版卷轴战斗游戏。玩家操控巫师角色，通过组合 7 种元素释放不同法术，与怪物、环境、召唤物和其他玩家产生复杂交互。

本游戏的核心设计目标是：

1. 不使用固定技能表作为唯一玩法来源，而是通过元素序列动态生成技能。
2. 玩家、怪物、召唤物、墙壁、环境区域共用同一套伤害、状态、Buff、元素反应逻辑。
3. 技能表现形态、元素伤害、状态效果、环境影响互相解耦。
4. 支持喷射、射线、飞行物、召唤物、环境场等多种攻击形态。
5. 支持脱手与非脱手技能在生命周期、友方判定和联机同步上的差异。
6. 支持法杖、装备、Buff 对技能结果进行修饰。
7. 后续新增元素组合、怪物技能、特殊法杖、环境机制时，尽量通过配置扩展，而不是新增大量硬编码技能类。

一句话总结：

> Endwell 的核心不是“技能系统”，而是“元素序列解析 + 统一施法生命周期 + 统一 Hit 管线 + 统一状态反应系统”。

---

## 2. 核心概念总览

游戏中的所有对象都被建模为 Entity。

```text
玩家、怪物、墙壁、火球、雷球、毒雾、火焰区域、冰墙、陨石、降雨、护盾
都不是特殊类，而是拥有不同组件的 Entity。
```

核心流程如下：

```text
ElementSequence
  ↓
SpellResolver
  ↓
SpellSpec
  ↓
CastStateMachine
  ↓
HitSource / Projectile / Beam / Zone / Summon / EnvironmentField
  ↓
HitEvent
  ↓
DamageSystem
  ↓
StatusSystem
  ↓
ReactionSystem
  ↓
BuffSystem
  ↓
GameEvent
  ↓
Render / VFX / Audio / UI
```

---

## 3. Entity 与 Component

### 3.1 Entity

Entity 是世界中的最小逻辑对象。

```ts
type EntityId = string;

interface Entity {
  id: EntityId;
  components: ComponentMap;
}
```

### 3.2 常见组件

#### Transform

表示实体位置、方向和尺寸。

```ts
interface Transform {
  position: Vec2;
  rotation: number;
  scale: Vec2;
}
```

#### Collider

表示实体是否参与碰撞。

```ts
interface Collider {
  shape: "circle" | "box" | "capsule" | "polygon";
  size: Vec2;
  radius?: number;
  isTrigger: boolean;
}
```

#### Health

表示实体生命值。

```ts
interface Health {
  current: number;
  max: number;
}
```

#### Damageable

表示实体是否可以受到伤害或治疗。

```ts
interface Damageable {
  canReceiveDamage: boolean;
  canReceiveHeal: boolean;
  invincible?: boolean;
}
```

#### Faction

表示阵营关系。

```ts
interface Faction {
  id: string;
  team: "player" | "monster" | "neutral" | "environment";
}
```

#### ElementStatus

表示元素异常状态。

```ts
interface ElementStatusComponent {
  statuses: Map<ElementStatusType, StatusInstance>;
  buildup: Partial<Record<ElementStatusType, number>>;
}
```

#### Buffs

表示普通 Buff、Debuff、装备加成、临时强化。

```ts
interface BuffComponent {
  buffs: BuffInstance[];
}
```

#### Obstacle

表示阻挡能力。

```ts
interface Obstacle {
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksBeam: boolean;
  blocksSpray: boolean;
  blocksVision: boolean;
  material: MaterialType;
}
```

#### SpellCaster

表示实体可以施法。

```ts
interface SpellCaster {
  selectedElements: Element[];
  castState: CastState;
  stats: CasterStats;
}
```

#### HitSource

表示实体可以产生命中事件。

```ts
interface HitSource {
  ownerId: EntityId;
  factionId: string;
  payload: HitPayload;
  delivery: DeliveryType;
  detached: boolean;
  tickInterval?: number;
  targeting: TargetingSpec;
  blocking: BlockingSpec;
}
```

---

## 4. 元素系统

### 4.1 元素类型

游戏包含 7 种基础元素：

```ts
type Element =
  | "rock"       // 岩
  | "fire"       // 火
  | "ice"        // 冰
  | "life"       // 生命
  | "lightning"  // 雷
  | "water"      // 水
  | "shield";    // 盾
```

### 4.2 元素分类

为了便于技能解析，元素分为三类：

| 分类   | 元素      | 作用                         |
| ---- | ------- | -------------------------- |
| 虚元素  | 火、水、冰、雷 | 主要决定伤害属性、异常状态、喷射类基础技能      |
| 实元素  | 岩、生命    | 改变技能形态，岩偏飞行物/物理冲击，生命偏射线/治疗 |
| 特殊元素 | 盾       | 生成护盾、屏障、召唤物、区域实体           |

```ts
const virtualElements = ["fire", "water", "ice", "lightning"];
const realElements = ["rock", "life"];
const specialElements = ["shield"];
```

---

## 5. 元素序列与技能解析

玩家点击屏幕下方元素按钮时，会形成一个元素序列。

```ts
type ElementSequence = Element[];
```

例如：

```ts
["fire"]
["fire", "life"]
["fire", "rock"]
["fire", "rock", "shield"]
["rock", "rock", "shield"]
["fire", "rock", "rock", "fire"]
["fire", "water", "water", "fire"]
```

元素序列不会直接等于技能，而是进入 `SpellResolver`，解析成 `SpellSpec`。

```ts
interface SpellSpec {
  id: string;

  elements: ElementSequence;
  elementVector: ElementVector;

  delivery: DeliveryType;
  payload: HitPayload;

  timing: CastTiming;
  targeting: TargetingSpec;
  blocking: BlockingSpec;

  detached: boolean;
  channelled: boolean;

  spray?: SpraySpec;
  beam?: BeamSpec;
  projectile?: ProjectileSpec;
  summon?: SummonSpec;
  area?: AreaSpec;
  shield?: ShieldSpec;

  tags: string[];
  visualKey: string;
}
```

---

## 6. 技能解析优先级

由于游戏既有通用组合规律，也有特殊大招，所以解析优先级必须明确。

推荐顺序：

```text
1. 卷轴特殊覆盖规则
2. 精确组合规则 ExactRecipe
3. 模式组合规则 PatternRecipe
4. 通用组合规则 GenericRule
5. 单元素默认规则
6. 无效组合 fallback
```

### 6.1 精确组合规则

精确组合适合设计特殊技能。

| 元素组合          | 技能   |
| ------------- | ---- |
| 火 + 岩 + 岩 + 火 | 陨石   |
| 火 + 水 + 水 + 火 | 全屏降雨 |
| 雷 + 水 + 雷 + 盾 | 雷暴领域 |
| 冰 + 水 + 岩 + 盾 | 冰封结界 |

精确组合优先级高于一般规律。

例如：

```ts
{
  id: "meteor",
  sequence: ["fire", "rock", "rock", "fire"],
  priority: 1000,
  delivery: "areaStrike",
  detached: true,
}
```

### 6.2 通用组合规则

| 组合模式          | 基础形态         | 示例          |
| ------------- | ------------ | ----------- |
| 单个元素          | 自我元素效果或基础短释放 | 火、水、雷、冰     |
| 两个以上虚元素       | 喷射           | 火+火，火+雷，火+水 |
| 虚元素 + 生命结尾    | 射线           | 火+生命，雷+生命   |
| 生命+生命         | 治疗射线         | 生命射线        |
| 虚元素 + 岩结尾     | 飞行物          | 火+岩，雷+岩     |
| 岩+岩           | 岩石飞行物        | 击退          |
| 虚元素 + 盾结尾     | 元素护盾         | 火+盾，雷+盾     |
| 虚元素 + 岩 + 盾结尾 | 召唤区域或实体      | 火区、雷区、冰墙    |
| 岩+岩+盾         | 岩墙           | 阻挡移动/飞行物/射线 |

---

## 7. 元素向量 ElementVector

元素序列会被统计成元素向量，用于计算伤害、状态积累、吟唱时间和技能强度。

```ts
interface ElementVector {
  rock: number;
  fire: number;
  ice: number;
  life: number;
  lightning: number;
  water: number;
  shield: number;
}
```

例如：

```ts
["fire", "fire", "life"]
```

会得到：

```ts
{
  fire: 2,
  life: 1,
  rock: 0,
  ice: 0,
  lightning: 0,
  water: 0,
  shield: 0,
}
```

元素数量越多，通常表示：

```text
威力更高
吟唱更久
后摇更长
消耗更高
更容易被打断
```

---

## 8. 攻击形态分类

### 8.1 喷射 Spray

喷射是非脱手持续技能。

特点：

```text
以释放者为中心
向引导方向短距离持续喷射
范围较宽
持续造成伤害
通常不会被墙体阻挡
不能脱离释放者存在
释放者死亡、松手或被打断后消失
通常不攻击友方
```

适合：

```text
火焰喷射
水流喷射
蒸汽喷射
冰霜喷射
雷火混合喷射
```

```ts
interface SpraySpec {
  range: number;
  angle: number;
  tickInterval: number;
  followsAim: boolean;
}
```

### 8.2 射线 Beam

射线是非脱手持续技能。

特点：

```text
以释放者为中心
向引导方向超远距离延伸
默认命中路径上的第一个目标
会被墙体或敌人阻挡
持续造成伤害或治疗
不能脱离释放者存在
```

```ts
interface BeamSpec {
  range: number;
  width: number;
  tickInterval: number;
  mode: "normal" | "reflect" | "pierce";
  reflect?: BeamReflectSpec;
  pierce?: BeamPierceSpec;
}
```

#### 普通射线

命中第一个有效目标后停止。

#### 反射射线

命中敌人或墙体后，向新的方向反射。

```ts
interface BeamReflectSpec {
  maxBounces: number;
  searchRadius: number;
  damageDecay: number;
}
```

#### 穿透射线

穿透路径上的多个目标，每次穿透伤害递减。

```ts
interface BeamPierceSpec {
  maxPierce: number;
  damageDecay: number;
}
```

### 8.3 飞行物 Projectile

飞行物是脱手技能。

特点：

```text
从释放者位置发射
沿目标方向运动
碰撞后触发命中
默认被敌人和墙体阻挡
释放后不依赖释放者继续存在
可以误伤友方
```

```ts
interface ProjectileSpec {
  speed: number;
  radius: number;
  lifetime: number;
  mode: "normal" | "homing" | "pierce";
  impactArea?: AreaSpec;
  homing?: HomingSpec;
  pierce?: ProjectilePierceSpec;
}
```

#### 普通飞行物

命中第一个目标或墙体后爆炸或消失。

#### 追踪飞行物

自动追踪目标区域内的敌人。

#### 穿透飞行物

穿过多个敌人，对路径上的所有目标造成伤害，伤害逐次衰减。是否穿墙由配置决定。

### 8.4 召唤物 Summon

召唤物是脱手技能。

特点：

```text
在指定位置创建实体
实体可以是墙、区域、陷阱、护盾、云、图腾
释放后独立存在
可以阻挡、造成伤害、治疗、施加状态或改变环境
```

```ts
interface SummonSpec {
  entityArchetype: string;
  positionMode: "targetPoint" | "casterFront" | "self" | "global";
  lifetime?: number;
  inheritFaction: boolean;
  detached: boolean;
}
```

### 8.5 区域攻击 Area

区域攻击通常是一次性或延迟爆发。

特点：

```text
对指定区域内所有目标产生一次 HitEvent
可附带预警阶段
适合陨石、爆炸、冰封、雷击
```

### 8.6 环境场 EnvironmentField

环境场是影响世界或局部区域的持续效果。

分为：

```text
局部环境：火焰区域、水域、雷区、毒雾、治疗区
全局环境：降雨、暴风雪、雷暴、浓雾
```

---

## 9. 脱手与非脱手

### 9.1 非脱手技能

非脱手技能被视为释放者身体或法杖的魔法延伸。

典型例子：

```text
喷射
射线
持续治疗射线
水流喷射
火焰喷射
```

规则：

```text
释放者死亡后消失
释放者被打断后消失
释放者松手后消失
通常不会攻击友方
通常不会被友方阻挡
引导期间可以改变方向
```

### 9.2 脱手技能

脱手技能被视为已经释放到世界中的独立对象。

典型例子：

```text
飞行物
陨石
岩墙
冰墙
火焰区域
雷电区域
降雨
毒雾
陷阱
```

规则：

```text
释放后独立存在
释放者死亡后通常不会消失
可能对友方产生影响
可能被友方阻挡
参与完整碰撞和元素反应
```

```ts
interface Ownership {
  ownerId: EntityId;
  factionId: string;
  detached: boolean;
  vanishOnOwnerDeath: boolean;
  vanishOnOwnerInterrupt: boolean;
}
```

---

## 10. 伤害类型分类

### 10.1 基础伤害类型

```ts
type DamageElement =
  | "physical"
  | "rock"
  | "fire"
  | "ice"
  | "life"
  | "lightning"
  | "water"
  | "shield"
  | "pure";
```

| 类型        | 说明                   |
| --------- | -------------------- |
| physical  | 普通物理伤害               |
| rock      | 岩属性伤害，常附带击退          |
| fire      | 火属性伤害，常附带燃烧          |
| ice       | 冰属性伤害，常附带减速或冻结       |
| life      | 生命属性，通常用于治疗，也可伤害特殊敌人 |
| lightning | 雷属性伤害，常附带打断、连锁、感电    |
| water     | 水属性伤害，常附带潮湿、击退       |
| shield    | 盾属性，主要用于护盾、屏障、吸收     |
| pure      | 真实伤害，不受普通抗性影响        |

### 10.2 伤害效果分类

| 分类   | 说明                  |
| ---- | ------------------- |
| 单体伤害 | 对单个目标造成一次伤害         |
| 持续伤害 | 在指定时间内，每隔一段时间造成一次伤害 |
| 范围伤害 | 对范围内所有目标造成一次伤害      |
| 连锁伤害 | 命中后寻找附近新目标继续跳跃      |
| 穿透伤害 | 依次命中路径上的多个目标        |
| 反射伤害 | 命中后改变方向继续寻找目标       |
| 环境伤害 | 由环境场周期性触发           |
| 反应伤害 | 由元素反应额外产生           |

---

## 11. HitPayload

所有伤害、治疗、击退、打断、状态积累都由 `HitPayload` 描述。

```ts
interface HitPayload {
  damage?: Partial<Record<DamageElement, number>>;
  heal?: number;

  statusBuildup?: Partial<Record<ElementStatusType, number>>;
  applyStatuses?: StatusApplication[];

  effects?: HitEffect[];

  poiseDamage?: number;
  interruptPower?: number;
}
```

示例：火焰射线

```ts
{
  damage: {
    fire: 12,
  },
  statusBuildup: {
    burning: 10,
  }
}
```

示例：水流喷射

```ts
{
  damage: {
    water: 8,
  },
  statusBuildup: {
    wet: 20,
  },
  effects: [
    { type: "knockback", force: 240 }
  ]
}
```

示例：生命射线

```ts
{
  heal: 10,
  effects: [
    { type: "cleanseStatus", statuses: ["burning", "poisoned"] }
  ]
}
```

---

## 12. HitEvent

所有攻击形态最终都会产生 `HitEvent`。

```ts
interface HitEvent {
  sourceId: EntityId;
  ownerId?: EntityId;
  targetId: EntityId;

  hitPoint: Vec2;
  hitNormal?: Vec2;

  payload: HitPayload;

  delivery: DeliveryType;
  detached: boolean;

  tags: string[];
}
```

统一命中流程：

```text
喷射 tick
射线 tick
飞行物碰撞
区域爆炸
火焰地面 tick
降雨 tick
怪物爪击
陷阱触发
```

全部转换成 `HitEvent`，进入统一结算管线。

---

## 13. 统一伤害计算公式

### 13.1 总体流程

一次命中的伤害结算顺序如下：

```text
1. 读取 HitPayload 基础伤害
2. 计算技能强度系数
3. 计算释放者加成
4. 计算形态系数
5. 计算环境系数
6. 计算目标状态反应系数
7. 计算暴击或特殊倍率
8. 计算目标抗性
9. 计算护盾吸收
10. 计算最终生命变化
11. 应用状态积累和额外效果
```

### 13.2 单一元素伤害公式

对于某一种元素 `e`，最终伤害为：

```text
FinalDamage[e]
=
BaseDamage[e]
× SpellPower
× DeliveryMultiplier
× CasterDamageMultiplier[e]
× BuffMultiplier[e]
× EnvironmentMultiplier[e]
× ReactionMultiplier[e]
× CriticalMultiplier
× ResistanceMultiplier[e]
× PierceOrChainDecay
- FlatReduction[e]
```

最终总伤害为：

```text
TotalDamage = sum(FinalDamage[e]) + PureDamage
```

其中：

```text
PureDamage 不受普通元素抗性影响，但仍可受全局减伤、护盾、无敌影响。
```

---

## 14. 伤害公式字段说明

### 14.1 BaseDamage

来自 `HitPayload.damage`。

例如：

```ts
damage: {
  fire: 20,
  lightning: 10,
}
```

表示该次命中有 20 点火伤害和 10 点雷伤害。

### 14.2 SpellPower

由元素数量、蓄力、技能等级、法杖基础强度决定。

推荐公式：

```text
SpellPower = 1 + ElementCountBonus + ChargeBonus + StaffPowerBonus
```

其中：

```text
ElementCountBonus = max(0, elementCount - 1) × 0.18
```

示例：

| 元素数量 | ElementCountBonus |
| ---- | ----------------- |
| 1    | 0                 |
| 2    | 0.18              |
| 3    | 0.36              |
| 4    | 0.54              |
| 5    | 0.72              |

如果一个 3 元素技能基础伤害为 20：

```text
SpellPower = 1 + 0.36 = 1.36
伤害 = 20 × 1.36 = 27.2
```

### 14.3 DeliveryMultiplier

不同攻击形态有不同倍率。

| 形态   |       倍率建议 | 说明           |
| ---- | ---------: | ------------ |
| 喷射   |       0.65 | 高频 tick，范围命中 |
| 射线   |       0.85 | 高频 tick，但偏单体 |
| 飞行物  |        1.2 | 单次命中，需要瞄准    |
| 范围爆发 |        1.0 | 命中多个目标       |
| 陨石   |        1.5 | 长吟唱，高风险高回报   |
| 环境区域 |       0.45 | 长时间持续 tick   |
| 连锁伤害 |        0.8 | 可命中多个目标      |
| 反射伤害 |       0.75 | 可多次命中        |
| 穿透伤害 | 1.0 起，后续衰减 | 路径命中多个目标     |

### 14.4 CasterDamageMultiplier

释放者自身属性影响。

```text
CasterDamageMultiplier[e]
=
1
+ elementalPowerBonus[e]
+ globalDamageBonus
+ spellTypeBonus
```

例如：

```text
释放者火焰加成 +20%
全局法术加成 +10%
射线技能加成 +15%
```

则火焰射线：

```text
CasterDamageMultiplier[fire] = 1 + 0.2 + 0.1 + 0.15 = 1.45
```

### 14.5 BuffMultiplier

Buff 对伤害的乘区。

建议把 Buff 分成加法组和乘法组，避免数值爆炸。

```text
BuffMultiplier[e]
=
(1 + sum(AdditiveDamageBonus[e]))
× product(MultiplicativeDamageBonus[e])
```

例如：

```text
火焰伤害 +20%
所有伤害 +10%
雨天火焰伤害 ×0.85
燃烧专精 ×1.15
```

则：

```text
BuffMultiplier[fire]
=
(1 + 0.2 + 0.1)
× 0.85
× 1.15
=
1.27075
```

### 14.6 EnvironmentMultiplier

环境影响。

例如：

| 环境  |    火 |   水 |    雷 |    冰 |
| --- | ---: | --: | ---: | ---: |
| 降雨  | 0.85 | 1.2 | 1.15 |  1.1 |
| 干燥  | 1.15 | 0.9 |  1.0 | 0.95 |
| 水域  |  0.9 | 1.2 | 1.25 |  1.1 |
| 暴风雪 |  0.8 | 1.0 |  1.0 | 1.25 |
| 雷暴  |  1.0 | 1.0 |  1.3 |  1.0 |

### 14.7 ReactionMultiplier

元素反应带来的伤害倍率。

例如：

```text
潮湿 + 火 = 蒸发，火伤害 ×1.4，并移除潮湿
潮湿 + 雷 = 感电，雷伤害 ×1.25，并触发打断和连锁
潮湿 + 冰 = 冻结，冰伤害 ×1.1，并冻结目标
燃烧 + 水 = 蒸汽，水伤害 ×1.15，并清除燃烧
```

### 14.8 CriticalMultiplier

暴击倍率。

推荐公式：

```text
CriticalMultiplier = isCritical ? CritDamage : 1
```

例如：

```text
基础暴击伤害 = 1.5
暴击伤害 Buff +30%
最终暴击倍率 = 1.8
```

### 14.9 ResistanceMultiplier

目标抗性影响。

目标拥有各元素抗性：

```ts
interface Resistance {
  values: Partial<Record<DamageElement, number>>;
}
```

抗性取值建议：

```text
1.0   = 完全免疫
0.5   = 减少 50% 伤害
0     = 正常伤害
-0.5  = 额外受到 50% 伤害
```

抗性倍率公式：

```text
ResistanceMultiplier[e] = 1 - clamp(Resistance[e], -1.0, 0.95)
```

例如：

```text
火抗性 0.4  → 受到 60% 火伤害
火抗性 0    → 受到 100% 火伤害
火抗性 -0.5 → 受到 150% 火伤害
火抗性 0.95 → 最少受到 5% 火伤害
```

不建议普通抗性达到 100% 完全免疫，除非是特殊机制，否则会让玩家组合失效。

### 14.10 PierceOrChainDecay

穿透、反射、连锁时需要伤害衰减。

```text
NthDamage = FirstDamage × decay ^ hitIndex
```

例如穿透衰减 `decay = 0.75`：

| 命中序号  |       倍率 |
| ----- | -------: |
| 第 1 个 |      1.0 |
| 第 2 个 |     0.75 |
| 第 3 个 |   0.5625 |
| 第 4 个 | 0.421875 |

Buff 可以降低衰减：

```text
原衰减 = 0.75
穿透强化 Buff = +0.1
最终衰减 = 0.85
```

### 14.11 FlatReduction

固定减伤在最后计算。

```text
DamageAfterFlatReduction = max(0, DamageBeforeFlatReduction - FlatReduction)
```

固定减伤适合：

```text
护甲
石肤
岩盾
小额伤害抵挡
```

不适合放在倍率之前，否则高频低伤技能会被完全废掉。

---

## 15. 完整伤害计算示例

假设玩家使用：

```text
火 + 雷 + 生命 = 火雷射线
```

基础伤害：

```ts
damage: {
  fire: 8,
  lightning: 9,
}
```

条件：

```text
元素数量 = 3
SpellPower = 1 + 0.36 = 1.36
DeliveryMultiplier = 射线 0.85
释放者火焰加成 +20%
释放者雷电加成 +10%
全局法术加成 +10%
目标处于潮湿
潮湿 + 雷：雷伤害 ×1.25
目标火抗性 0.2
目标雷抗性 -0.3
```

火伤害：

```text
FireDamage
=
8
× 1.36
× 0.85
× (1 + 0.2 + 0.1)
× 1
× 1
× (1 - 0.2)

= 9.61792
```

雷伤害：

```text
LightningDamage
=
9
× 1.36
× 0.85
× (1 + 0.1 + 0.1)
× 1.25
× (1 - -0.3)

= 20.286
```

最终总伤害：

```text
TotalDamage = 9.62 + 20.29 = 29.91
```

同时触发：

```text
目标进入 shocked 感电状态
施法可能造成 interrupt 打断
感电可以连锁到附近潮湿目标
```

---

## 16. 治疗计算公式

治疗与伤害共用部分机制，但不受普通抗性影响。

```text
FinalHeal
=
BaseHeal
× SpellPower
× DeliveryMultiplier
× CasterHealMultiplier
× BuffHealMultiplier
× TargetReceiveHealMultiplier
× EnvironmentHealMultiplier
```

生命射线示例：

```text
BaseHeal = 10
SpellPower = 1.18
DeliveryMultiplier = 0.85
CasterHealMultiplier = 1.2
TargetReceiveHealMultiplier = 1.0

FinalHeal = 10 × 1.18 × 0.85 × 1.2 = 12.036
```

特殊情况：

```text
亡灵敌人可以把生命治疗转化为生命伤害
中毒目标受到治疗时可以先削减毒素 buildup
燃烧目标受到生命治疗时可以正常回血，但不清除燃烧，除非 payload 里带 cleanse
```

---

## 17. 护盾与吸收

护盾不应该只是额外血条，而应该允许配置吸收类型。

```ts
interface ShieldLayer {
  id: string;
  amount: number;
  maxAmount: number;
  absorbElements: Partial<Record<DamageElement, number>>;
  priority: number;
  tags: string[];
}
```

例如火焰护盾：

```ts
{
  amount: 80,
  absorbElements: {
    fire: 0.8,
    ice: 0.3,
    physical: 0.2,
  }
}
```

表示：

```text
80% 火伤害先由护盾承担
30% 冰伤害先由护盾承担
20% 物理伤害先由护盾承担
```

护盾计算：

```text
DamageToShield[e] = Damage[e] × AbsorbRatio[e]
DamageToHealth[e] = Damage[e] - DamageToShield[e]
```

如果护盾量不足，剩余伤害进入生命值。

---

## 18. Buff 系统

Buff 是一切临时属性变化、装备加成、状态强化、法杖特效的统一表达。

### 18.1 Buff 结构

```ts
interface BuffInstance {
  id: string;
  sourceId?: EntityId;

  duration?: number;
  remaining?: number;

  stacks: number;
  maxStacks?: number;

  modifiers: StatModifier[];
  tags: string[];

  removeOnDeath?: boolean;
  removeOnCast?: boolean;
  removeOnHit?: boolean;
}
```

### 18.2 Modifier 结构

```ts
interface StatModifier {
  stat: string;
  op: "add" | "multiply" | "override" | "min" | "max";
  value: number;
  priority?: number;
}
```

### 18.3 常见 Buff 类型

| Buff 类型 | 示例                  |
| ------- | ------------------- |
| 伤害加成    | 火焰伤害 +20%           |
| 抗性加成    | 雷抗性 +30%            |
| 施法速度    | 吟唱时间 -15%           |
| 后摇减少    | recovery -20%       |
| 反射增强    | 射线反射次数 +1           |
| 穿透增强    | 穿透衰减从 0.75 提高到 0.85 |
| 护盾增强    | 护盾量 +50             |
| 状态免疫    | 免疫潮湿 5 秒            |
| 控制抵抗    | 被冻结时间 -40%          |
| 环境适应    | 雨天不因雷元素自我感电         |

---

## 19. Buff 叠加规则

为了避免数值混乱，Buff 叠加必须有明确规则。

### 19.1 加法组

同类加成先相加。

```text
火焰伤害 +20%
所有伤害 +10%
射线伤害 +15%

加法组结果 = 1 + 0.2 + 0.1 + 0.15 = 1.45
```

### 19.2 乘法组

特殊倍率再相乘。

```text
雨天火焰 ×0.85
目标潮湿蒸发 ×1.4
暴击 ×1.5

乘法组结果 = 0.85 × 1.4 × 1.5 = 1.785
```

### 19.3 最终 Buff 结果

```text
FinalMultiplier = AdditiveGroup × MultiplicativeGroup
```

例如：

```text
AdditiveGroup = 1.45
MultiplicativeGroup = 1.785

FinalMultiplier = 2.58825
```

### 19.4 override 规则

`override` 用于特殊机制，例如：

```text
本次射线改为反射射线
本次飞行物改为追踪飞行物
本次火焰伤害转化为冰伤害
本次技能无法误伤友方
```

多个 override 同时存在时，按 priority 决定。

```text
priority 高的覆盖 priority 低的。
```

---

## 20. Buff 对 SpellSpec 的修改

Buff 不只影响伤害，也可以修改技能形态。

例如：

### 20.1 增加射线反射次数

```ts
{
  id: "beam_reflect_plus_1",
  modifiers: [
    {
      stat: "beam.reflect.maxBounces",
      op: "add",
      value: 1,
    }
  ]
}
```

### 20.2 降低穿透衰减

```ts
{
  id: "pierce_decay_bonus",
  modifiers: [
    {
      stat: "beam.pierce.damageDecay",
      op: "add",
      value: 0.1,
    }
  ]
}
```

如果原本：

```text
damageDecay = 0.75
```

应用 Buff 后：

```text
damageDecay = 0.85
```

### 20.3 将火球改为追踪火球

```ts
{
  id: "homing_projectile_staff",
  modifiers: [
    {
      stat: "projectile.mode",
      op: "override",
      value: "homing",
      priority: 100,
    }
  ]
}
```

---

## 21. 元素状态系统

元素状态和普通 Buff 分开处理。

元素状态用于元素反应。Buff 用于数值和技能修饰。

### 21.1 元素状态类型

```ts
type ElementStatusType =
  | "wet"
  | "burning"
  | "chilled"
  | "frozen"
  | "shocked"
  | "poisoned"
  | "shielded"
  | "stoneArmor"
  | "regenerating";
```

### 21.2 状态积累 buildup

元素状态不一定一次命中就触发，而是先积累。

```ts
interface StatusApplication {
  type: ElementStatusType;
  buildup?: number;
  duration?: number;
  potency?: number;
}
```

例如：

```text
水伤害命中 → wet buildup +20
wet buildup 达到 100 → 获得 wet 状态
```

推荐阈值：

| 状态       |   触发阈值 |
| -------- | -----: |
| wet      |    100 |
| burning  |    100 |
| chilled  |    100 |
| frozen   | 特殊反应触发 |
| shocked  |    100 |
| poisoned |    100 |

### 21.3 状态实例

```ts
interface StatusInstance {
  type: ElementStatusType;
  duration: number;
  potency: number;
  stacks: number;
  sourceId?: EntityId;
  tags: string[];
}
```

---

## 22. 元素状态效果

### 22.1 潮湿 Wet

效果：

```text
增加受到雷元素伤害
被雷命中时触发感电
被火命中时触发蒸发并移除潮湿
被冰命中时触发冻结
自身施放雷元素时可能自我感电并打断
```

### 22.2 燃烧 Burning

效果：

```text
持续受到火伤害
可被水清除
可被冰削弱
提高受到水蒸汽反应影响
```

### 22.3 寒冷 Chilled

效果：

```text
移动速度降低
攻击速度降低
继续受到冰或在潮湿状态下受冰会冻结
```

### 22.4 冻结 Frozen

效果：

```text
无法移动
无法施法
受到岩伤害或物理伤害时可能碎裂，造成额外伤害
受到火伤害会提前解除冻结
```

### 22.5 感电 Shocked

效果：

```text
短暂硬直或施法打断
可向附近潮湿目标连锁
提升后续雷伤害
```

### 22.6 中毒 Poisoned

效果：

```text
持续受到毒或生命衰减伤害
受到生命治疗时可先削减毒素
受到火伤害时可根据规则爆燃或加速毒雾消散
```

---

## 23. 元素反应系统

元素反应由 `ReactionSystem` 统一处理，而不是写在具体技能里。

```ts
interface ReactionRule {
  id: string;
  trigger: ReactionTrigger;

  requiredTargetStatuses?: ElementStatusType[];
  requiredSourceElements?: Element[];
  requiredEnvironment?: string[];
  requiredTags?: string[];

  consumeStatuses?: ElementStatusType[];

  priority: number;

  output: ReactionOutput;
}
```

### 23.1 反应触发时机

```ts
type ReactionTrigger =
  | "onBeforeCast"
  | "onHit"
  | "onStatusApplied"
  | "onEnvironmentTick"
  | "onEnterArea"
  | "onProjectileImpact";
```

---

## 24. 核心元素反应规则

### 24.1 潮湿 + 雷 = 感电

```text
条件：
目标有 wet
本次 Hit 包含 lightning

结果：
雷伤害增加
目标获得 shocked
打断目标施法
向附近潮湿目标连锁
```

建议参数：

```text
ReactionMultiplier[lightning] = 1.25
interruptPower += 30
chainRadius = 180
maxChainTargets = 3
chainDecay = 0.75
```

### 24.2 潮湿 + 火 = 蒸发

```text
条件：
目标有 wet
本次 Hit 包含 fire

结果：
火伤害增加
移除 wet
生成蒸汽特效
可清除 burning
```

建议参数：

```text
ReactionMultiplier[fire] = 1.4
consume wet
```

### 24.3 潮湿 + 冰 = 冻结

```text
条件：
目标有 wet
本次 Hit 包含 ice

结果：
移除 wet
施加 frozen
```

建议参数：

```text
frozen duration = 1.5s ~ 2.5s
大型怪物持续时间降低
Boss 只进入 chilled 或短硬直
```

### 24.4 燃烧 + 水 = 灭火

```text
条件：
目标有 burning
本次 Hit 包含 water

结果：
移除 burning
施加 wet
生成蒸汽
```

### 24.5 冻结 + 岩 = 碎裂

```text
条件：
目标有 frozen
本次 Hit 包含 rock 或 physical

结果：
额外岩伤害
提前解除 frozen
造成击退或破甲
```

### 24.6 潮湿自身 + 施放雷 = 自身感电

```text
条件：
施法者有 wet
施法元素包含 lightning

结果：
施法被打断
自身受到雷伤害
自身获得 shocked
```

建议这条规则触发在 `onBeforeCast`。

---

## 25. 环境影响

环境可以影响角色、怪物、召唤物、飞行物和法术计算。

### 25.1 局部环境

局部环境通常是 Entity。

示例：

```text
火焰区域
水域
雷电区域
治疗区域
毒雾
冰霜地面
```

它们拥有：

```text
Transform
AreaCollider
EnvironmentField
HitSource
Lifetime
Renderable
```

### 25.2 全局环境

全局环境作用于整个地图。

示例：

```text
降雨
雷暴
暴风雪
浓雾
高温
```

### 25.3 降雨规则

降雨由特殊组合 `火 + 水 + 水 + 火` 召唤。

效果：

```text
所有玩家和怪物逐渐获得 wet
清除 burning
降低火焰伤害
提高水、雷、冰相关反应效率
增加雷自爆风险
```

建议参数：

```text
duration = 8s
tickInterval = 0.5s
wet buildup per tick = 18
fire damage multiplier = 0.85
water damage multiplier = 1.2
lightning damage multiplier = 1.15
ice damage multiplier = 1.1
```

---

## 26. 阵营、命中与阻挡

### 26.1 TargetingSpec

表示技能可以命中谁。

```ts
interface TargetingSpec {
  canHitSelf: boolean;
  canHitAllies: boolean;
  canHitEnemies: boolean;
  canHitNeutral: boolean;
  beneficial?: boolean;
}
```

### 26.2 BlockingSpec

表示技能会被谁阻挡。

```ts
interface BlockingSpec {
  blockBySelf: boolean;
  blockByAllies: boolean;
  blockByEnemies: boolean;
  blockByNeutral: boolean;
  blockByWalls: boolean;
  blockBySummons: boolean;
}
```

### 26.3 非脱手攻击推荐规则

```text
canHitEnemies = true
canHitAllies = false
blockByEnemies = true
blockByAllies = false
blockByWalls = 根据形态决定
```

### 26.4 脱手攻击推荐规则

```text
canHitEnemies = true
canHitAllies = true
canHitSelf = 可配置
blockByEnemies = true
blockByAllies = true
blockByWalls = true
```

### 26.5 生命射线特殊规则

```text
canHitAllies = true
canHitEnemies = false
beneficial = true
blockByAllies = true
blockByEnemies = false
```

如果存在亡灵敌人，可以通过标签特殊处理：

```text
target has tag undead
life heal converts to life damage
```

---

## 27. 障碍物与材质

墙壁、岩石、冰墙等都使用 `Obstacle` 和 `Material` 表达。

```ts
type MaterialType =
  | "stone"
  | "ice"
  | "wood"
  | "metal"
  | "water"
  | "magic"
  | "flesh";
```

### 27.1 岩墙

```text
阻挡移动
阻挡飞行物
阻挡射线
不阻挡喷射
可被攻击削减生命
对岩、物理抗性较高
对水、雷抗性较高
```

### 27.2 冰墙

```text
阻挡移动
阻挡飞行物
阻挡射线
周围减速
受到火伤害时额外损失生命
受到岩伤害时可能碎裂
```

### 27.3 火焰区域

```text
不阻挡移动
不阻挡射线
不阻挡飞行物
持续造成火伤
可被水削弱或熄灭
```

### 27.4 水域

```text
不阻挡移动
施加 wet
略微减速
被雷击时触发范围感电
```

---

## 28. 施法生命周期

所有玩家和怪物攻击都遵循统一施法生命周期。

```ts
type CastPhase =
  | "idle"
  | "chanting"
  | "warning"
  | "active"
  | "recovery"
  | "interrupted";
```

流程：

```text
Idle
  ↓ begin_cast
Chanting
  ↓ chant 完成
Warning，可选
  ↓ warning 完成
Active
  ↓ 松手 / 时间结束 / 被打断
Recovery
  ↓ recovery 完成
Idle
```

### 28.1 吟唱 Chanting

```text
按下屏幕开始吟唱
吟唱期间可以显示施法动作
被打断会进入 interrupted
吟唱时间和元素数量、技能类型、Buff 有关
```

### 28.2 预警 Warning

```text
适合陨石、Boss 技能、大范围地面攻击
预警阶段创建 WarningArea
WarningArea 没有伤害，只负责提示
```

### 28.3 引导 Active

```text
喷射和射线在 active 阶段持续存在
玩家拖动手指可以改变方向
飞行物和召唤物通常在 active 开始瞬间创建
```

### 28.4 后摇 Recovery

```text
后摇期间不能释放下一个法术
可以允许移动，但不能再次施法
后摇时间受技能重量和 Buff 影响
```

### 28.5 打断 Interrupted

打断来源：

```text
受到雷击
受到强击退
受到冻结
受到眩晕
释放者死亡
潮湿状态下施放雷导致自爆
```

打断后：

```text
非脱手技能立即消失
进入短暂 recovery 或硬直
已脱手技能通常不消失
```

---

## 29. 施法时间公式

```text
FinalChantTime
=
BaseChantTime
+ ElementCountPenalty
+ DeliveryChantPenalty
- CasterCastSpeedReduction
```

推荐：

```text
ElementCountPenalty = max(0, elementCount - 1) × 0.12s
```

形态额外时间：

| 形态   |  额外吟唱 |
| ---- | ----: |
| 单元素  |    0s |
| 喷射   |  0.1s |
| 射线   |  0.2s |
| 飞行物  | 0.25s |
| 召唤区域 |  0.4s |
| 墙体   | 0.45s |
| 陨石   |  0.8s |
| 全局天气 |  1.0s |

后摇公式：

```text
FinalRecoveryTime
=
BaseRecovery
+ DeliveryRecoveryPenalty
+ ElementCount × 0.05s
- RecoveryReductionBuff
```

---

## 30. 装备机制

Magicka 中角色拥有三类核心装备槽位：

```text
法杖 Staff
法袍 Robe
法戒 Ring
```

三类装备都可以为装备者提供数值加成，并且都会影响角色外观。装备外观不通过技能或临时特效同步，而是作为角色权威状态的一部分，由已有的玩家状态同步机制广播给所有玩家。

装备系统的目标不是让所有装备都提供类似的泛用属性，而是让不同槽位承担不同构筑职责：

| 装备槽位 | 核心职责      | 影响方向               |
| ---- | --------- | ------------------ |
| 法杖   | 元素专精与伤害构筑 | 元素伤害、元素治疗、特定元素法术强化 |
| 法袍   | 生存与机动能力   | 减伤、移速              |
| 法戒   | 施法节奏与作用范围 | 吟唱速度、后摇、技能范围       |

设计原则：

```text
法杖决定你擅长使用什么元素。
法袍决定你如何生存和移动。
法戒决定你如何施法，以及技能影响多大范围。
```

---

### 30.1 装备槽位

```ts
type EquipmentSlot = "staff" | "robe" | "ring";

interface EquipmentComponent {
  staff?: EquipmentItem;
  robe?: EquipmentItem;
  ring?: EquipmentItem;
}
```

装备项：

```ts
interface EquipmentItem {
  id: string;
  slot: EquipmentSlot;
  rarity: EquipmentRarity;

  name: string;
  visualKey: string;

  affixes: EquipmentAffix[];

  tags: string[];
}
```

稀有度：

```ts
type EquipmentRarity = "normal" | "excellent" | "rare";
```

稀有度决定词缀数量：

| 稀有度          | 词缀数量 |
| ------------ | ---: |
| 普通 normal    |    0 |
| 优秀 excellent |    1 |
| 稀有 rare      |    2 |

```text
普通装备只改变外观或提供基础模板能力。
优秀装备拥有 1 条词缀。
稀有装备拥有 2 条词缀。
```

---

### 30.2 槽位词缀隔离

装备词缀池必须按槽位隔离，禁止跨槽位生成属性。

也就是说：

```text
法杖只生成元素专精、元素伤害、元素治疗相关属性。
法袍只生成减伤或移动速度相关属性。
法戒只生成施法速度或技能范围相关属性。
```

禁止出现：

```text
法袍增加火焰伤害
法戒增加雷元素伤害
法杖增加移动速度
法戒增加减伤
法袍增加吟唱速度
```

这样可以避免三个槽位最终都变成“堆伤害/堆速度”的同质化装备。

---

### 30.3 法杖 Staff

法杖负责元素专精和伤害构筑。

六种法杖专精分别对应：

```ts
type StaffSpecialization =
  | "rock"
  | "lightning"
  | "water"
  | "life"
  | "fire"
  | "ice";
```

注意：`shield` 不作为常规法杖专精。盾元素主要由护盾、召唤、屏障和防御类机制承担，不进入六大专精池。

法杖专精的核心规则是：

```text
法杖只增强对应元素的伤害分量。
混合法术不会因为包含一个专精元素，就让整道法术全部增伤。
```

例如玩家装备火焰专精法杖，释放：

```text
火 + 雷 + 生命 = 火雷射线
```

该法术的基础伤害可能为：

```ts
damage: {
  fire: 8,
  lightning: 9,
}
```

如果法杖提供：

```text
火元素伤害 +30%
```

那么只增强火元素部分：

```text
fire: 8 × 1.3
lightning: 9 × 1.0
```

而不是整道火雷射线全部乘以 1.3。

错误做法：

```text
(火伤害 + 雷伤害) × 1.3
```

正确做法：

```text
火伤害 × 1.3 + 雷伤害 × 1.0
```

---

### 30.4 生命专精例外

生命专精是自然例外。

生命元素通常用于治疗，而不是常规伤害。因此生命专精法杖的主要效果是：

```text
增强含生命元素法术的治疗量。
```

例如：

```text
生命 + 生命 = 生命射线
```

基础治疗：

```ts
heal: 10
```

装备生命专精法杖：

```text
生命治疗 +25%
```

最终治疗：

```text
10 × 1.25 = 12.5
```

如果某些特殊目标，例如亡灵敌人，会把生命治疗转化为生命伤害，则生命专精可以按规则影响这部分转化后的生命伤害。

推荐规则：

```text
普通单位：生命专精增强治疗量。
亡灵单位：生命专精增强由生命治疗转化而来的生命伤害。
普通混合法术：生命专精不增强非生命伤害部分。
```

例如：

```text
火 + 生命 = 火焰射线
```

如果该技能主要造成火伤害，不包含治疗，则生命专精不应让火焰伤害获得完整加成。

如果该技能同时拥有：

```ts
damage: {
  fire: 10
},
heal: 4
```

那么生命专精只增强 `heal` 部分，不增强 `fire` 部分。

---

### 30.5 法杖词缀池

法杖词缀只允许出现元素专精相关属性。

示例词缀：

```ts
type StaffAffix =
  | { type: "elementDamageBonus"; element: "rock"; value: number }
  | { type: "elementDamageBonus"; element: "lightning"; value: number }
  | { type: "elementDamageBonus"; element: "water"; value: number }
  | { type: "elementDamageBonus"; element: "fire"; value: number }
  | { type: "elementDamageBonus"; element: "ice"; value: number }
  | { type: "lifeHealBonus"; value: number };
```

示例：

```ts
{
  id: "staff_fire_rare_001",
  slot: "staff",
  rarity: "rare",
  name: "焦黑橡木法杖",
  visualKey: "staff.charred_oak",
  affixes: [
    {
      type: "elementDamageBonus",
      element: "fire",
      value: 0.25
    },
    {
      type: "elementDamageBonus",
      element: "rock",
      value: 0.12
    }
  ],
  tags: ["staff", "fire", "rock"]
}
```

该法杖表示：

```text
火元素伤害 +25%
岩元素伤害 +12%
```

当玩家释放火岩混合法术时：

```text
火伤害部分获得 +25%
岩伤害部分获得 +12%
其他元素伤害不变
```

---

### 30.6 法袍 Robe

法袍负责生存和移动能力。

法袍只允许生成两类属性：

```text
减伤
移动速度
```

法袍不提供元素伤害，不提供施法速度，不提供技能范围。

法袍的设计目标是让玩家在战斗中选择不同的生存方式：

```text
重型法袍：更高减伤，移动较慢。
轻型法袍：更快移动，减伤较低。
元素抗性法袍：针对特定元素减少伤害。
```

法袍词缀示例：

```ts
type RobeAffix =
  | { type: "globalDamageReduction"; value: number }
  | { type: "elementDamageReduction"; element: DamageElement; value: number }
  | { type: "moveSpeedBonus"; value: number };
```

示例：

```ts
{
  id: "robe_rare_icewalker",
  slot: "robe",
  rarity: "rare",
  name: "踏霜法袍",
  visualKey: "robe.icewalker",
  affixes: [
    {
      type: "elementDamageReduction",
      element: "ice",
      value: 0.25
    },
    {
      type: "moveSpeedBonus",
      value: 0.08
    }
  ],
  tags: ["robe", "ice", "mobility"]
}
```

表示：

```text
受到冰元素伤害 -25%
移动速度 +8%
```

---

### 30.7 法戒 Ring

法戒负责施法节奏和作用范围。

法戒只允许生成两类属性：

```text
施法速度
作用范围
```

法戒不提供直接伤害，不提供减伤，不提供移动速度。

法戒影响的是“法术如何释放”，而不是“法术本身伤害有多高”。

法戒词缀示例：

```ts
type RingAffix =
  | { type: "chantTimeReduction"; value: number }
  | { type: "recoveryTimeReduction"; value: number }
  | { type: "areaRadiusBonus"; value: number }
  | { type: "beamRangeBonus"; value: number }
  | { type: "sprayRangeBonus"; value: number }
  | { type: "projectileRangeBonus"; value: number };
```

示例：

```ts
{
  id: "ring_rare_widecast",
  slot: "ring",
  rarity: "rare",
  name: "扩域法戒",
  visualKey: "ring.widecast",
  affixes: [
    {
      type: "areaRadiusBonus",
      value: 0.18
    },
    {
      type: "chantTimeReduction",
      value: 0.1
    }
  ],
  tags: ["ring", "area", "cast_speed"]
}
```

表示：

```text
范围类技能半径 +18%
吟唱时间 -10%
```

---

### 30.8 装备对伤害公式的影响

装备加成会进入统一伤害公式。

原公式：

```text
FinalDamage[e]
=
BaseDamage[e]
× SpellPower
× DeliveryMultiplier
× CasterDamageMultiplier[e]
× BuffMultiplier[e]
× EnvironmentMultiplier[e]
× ReactionMultiplier[e]
× CriticalMultiplier
× ResistanceMultiplier[e]
× PierceOrChainDecay
- FlatReduction[e]
```

装备影响后，可以理解为：

```text
FinalDamage[e]
=
BaseDamage[e]
× SpellPower
× DeliveryMultiplier
× EquipmentElementMultiplier[e]
× CasterDamageMultiplier[e]
× BuffMultiplier[e]
× EnvironmentMultiplier[e]
× ReactionMultiplier[e]
× CriticalMultiplier
× ResistanceMultiplier[e]
× PierceOrChainDecay
- FlatReduction[e]
```

其中：

```text
EquipmentElementMultiplier[e]
=
1 + StaffElementBonus[e]
```

例如火专精法杖：

```text
StaffElementBonus[fire] = 0.3
StaffElementBonus[lightning] = 0
StaffElementBonus[water] = 0
```

所以：

```text
EquipmentElementMultiplier[fire] = 1.3
EquipmentElementMultiplier[lightning] = 1.0
EquipmentElementMultiplier[water] = 1.0
```

---

### 30.9 装备对治疗公式的影响

治疗公式：

```text
FinalHeal
=
BaseHeal
× SpellPower
× DeliveryMultiplier
× EquipmentHealMultiplier
× CasterHealMultiplier
× BuffHealMultiplier
× TargetReceiveHealMultiplier
× EnvironmentHealMultiplier
```

生命专精法杖影响：

```text
EquipmentHealMultiplier = 1 + StaffLifeHealBonus
```

例如：

```text
生命治疗 +25%
```

则：

```text
EquipmentHealMultiplier = 1.25
```

---

### 30.10 装备对施法时间的影响

法戒可以影响吟唱时间和后摇时间。

原公式：

```text
FinalChantTime
=
BaseChantTime
+ ElementCountPenalty
+ DeliveryChantPenalty
- CasterCastSpeedReduction
```

加入装备后：

```text
FinalChantTime
=
(
  BaseChantTime
  + ElementCountPenalty
  + DeliveryChantPenalty
)
× (1 - RingChantTimeReduction)
× (1 - BuffChantTimeReduction)
```

为了避免堆叠过强，推荐设置下限：

```text
FinalChantTime >= BaseChantTime × 0.45
```

后摇公式：

```text
FinalRecoveryTime
=
(
  BaseRecovery
  + DeliveryRecoveryPenalty
  + ElementCount × 0.05s
)
× (1 - RingRecoveryTimeReduction)
× (1 - BuffRecoveryTimeReduction)
```

推荐下限：

```text
FinalRecoveryTime >= BaseRecovery × 0.5
```

---

### 30.11 装备对技能范围的影响

法戒可以影响不同技能形态的范围。

```text
喷射技能：影响 spray.range
射线技能：影响 beam.range
飞行物技能：影响 projectile.lifetime 或 projectile.range
区域技能：影响 area.radius
召唤区域：影响 AreaCollider.radius
```

推荐统一公式：

```text
FinalRange = BaseRange × (1 + RingRangeBonus + BuffRangeBonus)
```

范围类技能：

```text
FinalRadius = BaseRadius × (1 + RingAreaRadiusBonus + BuffAreaRadiusBonus)
```

需要注意：

```text
法戒只改变技能覆盖范围，不直接增加伤害。
```

如果范围变大导致命中目标更多，这是空间收益，不是直接伤害加成。

---

### 30.12 装备对减伤和移动的影响

法袍进入目标防御侧计算。

减伤建议分为两类：

```text
全局减伤
元素减伤
```

```text
DamageAfterRobeReduction[e]
=
DamageBeforeRobeReduction[e]
× (1 - GlobalDamageReduction)
× (1 - ElementDamageReduction[e])
```

例如：

```text
受到 100 点火伤害
法袍全局减伤 10%
火元素减伤 20%
```

则：

```text
FinalDamage
=
100 × 0.9 × 0.8
=
72
```

移动速度公式：

```text
FinalMoveSpeed
=
BaseMoveSpeed
× (1 + RobeMoveSpeedBonus + BuffMoveSpeedBonus)
× StatusMoveMultiplier
```

例如：

```text
基础移速 100
法袍移速 +8%
寒冷状态移速 ×0.7
```

则：

```text
FinalMoveSpeed = 100 × 1.08 × 0.7 = 75.6
```

---

### 30.13 装备外观同步

三槽装备都会影响角色外观。

```ts
interface PlayerAppearance {
  baseSkin: string;
  staffVisualKey?: string;
  robeVisualKey?: string;
  ringVisualKey?: string;
}
```

装备变化时，角色权威状态需要包含：

```ts
interface AuthoritativePlayerState {
  entityId: EntityId;
  position: Vec2;
  facing: Direction;
  health: Health;
  elementStatuses: ElementStatusSnapshot;
  equipment: EquipmentSnapshot;
  appearance: PlayerAppearance;
}
```

装备外观同步规则：

```text
装备变化由权威状态确认。
其他客户端不根据本地猜测切换外观。
所有玩家通过同步后的 PlayerAppearance 渲染对应装备。
技能效果仍由 SpellSpec 和战斗系统决定。
```

这样可以保证：

```text
玩家看到的法杖、法袍、法戒外观一致。
装备带来的数值效果由权威状态决定。
联机时不会出现本地外观和实际属性不一致的问题。
```

---

### 30.14 装备生成规则

装备生成需要遵守槽位隔离和稀有度词缀数量规则。

```ts
function generateEquipment(slot: EquipmentSlot, rarity: EquipmentRarity): EquipmentItem {
  const affixCount = getAffixCountByRarity(rarity);
  const affixPool = getAffixPoolBySlot(slot);

  return {
    id: createId(),
    slot,
    rarity,
    name: generateEquipmentName(slot, rarity),
    visualKey: pickVisualKey(slot, rarity),
    affixes: rollAffixes(affixPool, affixCount),
    tags: [slot, rarity],
  };
}
```

词缀数量：

```ts
function getAffixCountByRarity(rarity: EquipmentRarity): number {
  switch (rarity) {
    case "normal":
      return 0;
    case "excellent":
      return 1;
    case "rare":
      return 2;
  }
}
```

词缀池：

```ts
function getAffixPoolBySlot(slot: EquipmentSlot): EquipmentAffixPool {
  switch (slot) {
    case "staff":
      return staffAffixPool;

    case "robe":
      return robeAffixPool;

    case "ring":
      return ringAffixPool;
  }
}
```

生成约束：

```text
普通装备：0 条词缀
优秀装备：1 条词缀
稀有装备：2 条词缀

法杖：只从法杖词缀池抽取
法袍：只从法袍词缀池抽取
法戒：只从法戒词缀池抽取

同一装备不应生成完全重复词缀
同类词缀可以允许高低数值差异，但不建议重复堆叠同一个元素
```

---

### 30.15 装备机制总结

装备系统的最终设计目标是让三类装备形成明确分工：

```text
法杖 = 元素专精和伤害构筑
法袍 = 减伤和移动能力
法戒 = 施法节奏和作用范围
```

装备不会破坏元素系统，而是作为构筑层影响已有机制：

```text
法杖修改元素伤害分量或生命治疗量。
法袍修改受到伤害和移动速度。
法戒修改吟唱、后摇和技能范围。
```

最关键的规则是：

```text
混合法术按元素分量独立计算装备加成。
不能因为包含一个专精元素，就让整道混合法术全部增伤。
```

例如：

```text
火专精法杖只增强火伤害部分。
雷专精法杖只增强雷伤害部分。
水专精法杖只增强水伤害部分。
生命专精法杖主要增强治疗量。
```

三槽装备通过槽位隔离避免同质化：

```text
法杖不生成移速和减伤。
法袍不生成伤害和施法速度。
法戒不生成伤害和减伤。
```

这样每个装备槽都拥有清晰职责，玩家构筑也会更容易理解。

## 31. 推荐 MVP 技能组合

| 组合      | 形态  | 效果       |
| ------- | --- | -------- |
| 火       | 喷射  | 短距离火焰，燃烧 |
| 水       | 喷射  | 水流，潮湿，击退 |
| 雷       | 喷射  | 短电弧，打断   |
| 冰       | 喷射  | 寒气，减速    |
| 火+火     | 喷射  | 更强火焰喷射   |
| 火+水     | 喷射  | 蒸汽喷射     |
| 火+雷     | 喷射  | 火雷混合喷射   |
| 火+生命    | 射线  | 火焰射线     |
| 雷+生命    | 射线  | 雷电射线     |
| 生命+生命   | 射线  | 治疗射线     |
| 火+岩     | 飞行物 | 火焰石块，爆炸  |
| 雷+岩     | 飞行物 | 雷电石块，打断  |
| 水+岩     | 飞行物 | 水球，击退，潮湿 |
| 岩+岩     | 飞行物 | 岩石块，强击退  |
| 火+盾     | 护盾  | 火焰护盾     |
| 雷+盾     | 护盾  | 雷电护盾     |
| 火+岩+盾   | 召唤  | 火焰区域     |
| 雷+岩+盾   | 召唤  | 雷电区域     |
| 冰+岩+盾   | 召唤  | 冰墙       |
| 岩+岩+盾   | 召唤  | 岩墙       |
| 火+岩+岩+火 | 区域  | 陨石       |
| 火+水+水+火 | 天气  | 全屏降雨     |

### 31.1 Magicka 特殊配方映射

以下非卷轴特殊配方按严格顺序优先于通用组合解析。Endwell 中优先复用现有 `SpellSpec` 形态；牵引、连锁、穿透等复杂效果以当前 MVP 管线可表达的版本实现。

| 配方 | Endwell 实现 |
| --- | --- |
| 雷+生命+雷 | 复活术，目标区域内倒地友方恢复 25% 最大生命 |
| 雷+盾+雷 | 瞬间移动，移动到可达目标点 |
| 生命+冰+盾 | 消除术，清除目标区域状态和 buildup |
| 雷+盾+火 | 加速，自身获得短时 `hasted` |
| 水+生命 | 生命之泉，短时治疗场并施加潮湿 |
| 生命+雷+生命 | 连锁治疗，MVP 为范围治疗 |
| 盾+岩 / 火 / 冰 / 雷 / 水 | 对应元素护盾，火/冰/水/雷护盾额外提供状态免疫 |
| 火+生命 | 生命烈焰，持续火焰射线 |
| 水+冰 | 冻结水流，持续水冰射线 |
| 岩+火 / 岩+冰 | 熔岩弹 / 碎冰岩弹 |
| 水+雷 | 导电水链，MVP 为定点雷水范围打断 |
| 火+火 | 烈焰喷射 |
| 冰+冰+岩 | 寒冰长矛，带穿透标记的高速冰投射物 |
| 水+岩+水 | 潮汐冲击，生成水域并强击退 |
| 雷+火+火+雷 | 雷击术，短时雷击领域 |
| 水+冰+冰+水 | 暴风雪，全场周期性寒冷 |
| 火+水 | 蒸汽云，落点持续蒸汽区 |
| 冰+盾+盾+冰 | 冰墙 |
| 雷+水+雷+盾 | 雷暴领域 |
| 岩+盾+雷+岩 | 重力井，MVP 为持续岩伤场，牵引以击退效果表达 |
| 火+盾+火 | 火焰环，自身中心持续火场 |
| 生命+盾+生命+盾 | 生命屏障，持续治疗区 |

### 31.2 卷轴道具与强力咒语

卷轴是背包道具，不占用法杖、法袍、法戒槽位。玩家背包中持有卷轴时，对应元素组合会优先解析为卷轴咒语；释放后卷轴进入 20 秒冷却，但卷轴不消耗。冷却期间输入相同组合会回退到普通元素解析结果。

卷轴解析优先级：

```text
1. 背包持有对应卷轴，且卷轴冷却已结束
2. 非卷轴特殊配方 ExactRecipe
3. 通用元素组合规则
```

当前 Endwell 实现的卷轴：

| 卷轴 | 元素组合 | Endwell 实现 |
| --- | --- | --- |
| 超新星爆发 | 雷+生命+盾+火 | 全场存活玩家与怪物损失 50% 当前生命 |
| 均衡术 | 岩+盾+冰+生命 | 全场存活玩家与怪物生命设为 50% 最大生命 |
| 湮灭术 | 岩+冰+生命 | 定点范围内恰好一个目标时，该目标损失 99% 当前生命；目标数不对则无效果 |
| 黑洞 | 盾+岩+岩+盾 | 目标点生成 8 秒黑洞场，半径大、无差别周期 pure 伤害 |

卷轴来源：

```text
训练版中，卷轴可通过地面掉落或商人购买获得。
后续可把 Boss 必掉、精英高概率、宝箱低概率接入同一 ScrollItem 目录。
```

---

## 32. 推荐 MVP 元素反应

| 条件                     | 结果             |
| ---------------------- | -------------- |
| wet + lightning        | 感电、打断、连锁       |
| wet + fire             | 蒸发、火伤增加、移除 wet |
| wet + ice              | 冻结             |
| burning + water        | 灭火、施加 wet      |
| frozen + rock          | 碎裂、额外岩伤        |
| rain + lightning cast  | 自身感电、打断施法      |
| ice wall + fire        | 冰墙额外损失生命       |
| water pool + lightning | 范围感电           |
| rock wall + projectile | 阻挡飞行物并受伤       |

---

## 33. 结算顺序规范

所有 HitEvent 必须按固定顺序结算，避免规则混乱。

推荐顺序：

```text
1. 收集 HitEvent
2. 校验 source / target 是否存在
3. 阵营过滤
4. 阻挡过滤
5. 无敌 / 免疫检查
6. 触发 onBeforeHit 反应
7. 计算基础伤害
8. 应用释放者 Buff
9. 应用环境倍率
10. 应用元素反应倍率
11. 应用目标抗性
12. 应用护盾吸收
13. 应用最终伤害或治疗
14. 应用击退、打断、硬直
15. 增加状态 buildup
16. buildup 达阈值后施加状态
17. 触发 onStatusApplied 反应
18. 处理死亡、破坏、召唤物消失
19. 生成 GameEvent 给表现层
```

---

## 34. 表现层事件

逻辑层不直接播放动画，而是抛出事件。

```ts
type GameEvent =
  | { type: "damage_applied"; targetId: EntityId; amount: number; element: DamageElement }
  | { type: "heal_applied"; targetId: EntityId; amount: number }
  | { type: "status_applied"; targetId: EntityId; status: ElementStatusType }
  | { type: "reaction_triggered"; id: string; position: Vec2 }
  | { type: "entity_destroyed"; entityId: EntityId }
  | { type: "cast_started"; casterId: EntityId; spellId: string }
  | { type: "cast_interrupted"; casterId: EntityId; reason: string };
```

表现层根据事件播放：

```text
伤害数字
命中特效
燃烧动画
潮湿水滴
感电闪光
冰冻模型
蒸汽特效
屏幕震动
音效
UI 状态图标
```

---

## 35. 总结

Endwell 的最佳机制架构是：

```text
元素序列负责“玩家输入”
SpellResolver 负责“把输入变成技能规格”
CastSystem 负责“施法生命周期”
HitSource 负责“产生命中”
HitEvent 负责“统一战斗入口”
DamageSystem 负责“伤害和治疗”
StatusSystem 负责“状态积累和持续效果”
ReactionSystem 负责“元素反应”
BuffSystem 负责“数值和技能修饰”
EnvironmentSystem 负责“世界影响”
RenderSystem 负责“表现”
```

最重要的原则是：

```text
不要为每个技能写一个独立类。
不要为玩家、怪物、墙壁分别写伤害逻辑。
不要把元素反应写死在技能内部。
不要让动画决定伤害。
```

而应该做到：

```text
技能是元素序列解析出来的 SpellSpec。
攻击只是不同形态的 HitSource。
实体是否能受伤、能阻挡、能反应，由 Component 决定。
所有伤害、治疗、状态、Buff、元素反应都走统一管线。
```

这样设计之后，后续新增内容会非常自然：

```text
新增一个法杖 = 添加 SpellSpec Modifier
新增一个怪物技能 = 添加 SpellSpec 或元素序列
新增一个元素反应 = 添加 ReactionRule
新增一个墙体 = 添加 Entity Archetype
新增一个环境 = 添加 EnvironmentField
新增一个 Buff = 添加 StatModifier
```

这套机制可以同时支持轻量 MVP 和后续复杂扩展，是比较适合 parti/Endwell 的长期架构。

---

## 33. 训练场测试规则

当前 Endwell 原型仍是单训练场切片，初始房间用于验证战斗、装备、卷轴和合成流程：

- 玩家拥有死亡状态。生命归零后不能移动、施法、攻击、拾取、交易或合成，只能等待队友使用复活术复活。
- 复活术仍由 `雷 + 命 + 雷` 触发，复活同阵营死亡玩家，并清理死亡期间残留的状态积累。
- 测试房间会投放高强度装备、合成宝珠和多种卷轴，商人也会出售更多装备、宝珠和完整卷轴集合。

## 训练版交互与碰撞补充

- 玩家喷射法术的基础锥角为 60°，烈焰喷射为 70°。装备可分别强化喷射距离与角度，角度上限为 100°。
- 非穿透射线会被地图墙体、阻挡地形、怪物和阻挡射线的召唤物截断。反射射线在这些表面按碰撞法线偏转，穿透射线不参与阻挡或反射。
- 引导射线拥有固定转向速度，瞄准输入只更新目标方向，实际射线方向随权威世界更新平滑逼近。
- 瞬间移动沿目标方向寻找最远安全落点，不可穿越障碍，也不能进入或离开正在封锁的遭遇房与激活中的 Boss 房。
- 单独施放生命元素会立即治疗自己；多个生命元素仍解析为持续治疗射线。
- 商人与合成台只会生成在完整可站立且不与阻挡地形重叠的位置，并优先分配到不同房间。
- 小地图显示已探索房间通往未知房间入口的走廊，但不提前揭示未知房间及其中标记。
- 特殊法术书为单局队伍共享记录。复活术默认收录，其他精确配方法术在首次成功激活后解锁，新一局重置。
- 玩家和怪物受击时应显示短暂伤害/治疗反馈，并在血条附近展示潮湿、感电、冻结、加速等状态。
- 训练怪 `monster:training` 死亡后会短暂消失并自动重生，方便反复测试法术、装备和卷轴效果。

## 本地优先同步契约

- `cast.request`、`cast.activate`、`cast.aim`、`cast.release` 与 `combat.hit` 使用 `hostRelay`：发起客户端先执行同一套 reducer，Worker 随后校验并写入权威状态。
- 吟唱截止时间由本地状态立即推进。客户端到点发送稳定 `castId` 的 `cast.activate`；Worker 校验施法者、阶段与截止时间，权威定时器仅在客户端漏发时兜底。
- 本机拥有的射线和喷射每帧绑定本地角色位置。瞄准输入立即更新目标方向，射线按 `beam.turnSpeed` 平滑转向；方向同步不阻塞本地表现。
- 本地碰撞立即生成稳定 `hitId`，并进入统一 Hit、伤害、状态与反应管线。Worker 重新验证来源、空间关系、目标和 tick 去重，生命、死亡、状态与掉落最终以 Worker 为准。
- 客户端保留尚未被权威状态确认的激活、释放与命中预测；旧快照到达时重放这些预测，确认后清理，拒绝或超时后放弃并由后续权威快照纠正。
- 怪物 AI、怪物施法、环境 tick、刷怪、Boss 与关卡结算只在 Worker 权威系统中推进。
