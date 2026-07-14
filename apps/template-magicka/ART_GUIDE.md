# Room Magicka 像素资源制作指南

运行时契约定义在 `src/art/manifest.ts`，程序化占位渲染定义在 `src/art/pixelArt.ts`。正式 PNG 可以逐项加入，不完整的资源包不会阻塞游戏运行。

## 玩家图集

- 单帧 `64×64`，脚底锚点固定为 `(32, 52)`，透明背景。
- 只绘制 `S / SE / E / NE / N` 五个方向；西向由运行时镜像。
- 每个图层必须使用同一画布、帧序和锚点：`body`、`robe`、`back-arm`、`front-arm`、`staff`。
- 帧序：`idle 4`、`move 6`、`cast-windup 4`、`channel 4`、`cast-release 3`、`recovery 3`、`hit 3`、`stunned 2`、`downed 4`、`revive 5`。
- 不要在精灵中绘制姓名、血条、状态粒子、戒指光环和阴影；这些由运行时生成。

建议先制作竖向条带，每行一个动画、每列一个帧。最终打包可以改变帧位置，但 JSON 中必须记录每帧矩形、时长与锚点。

## 锚点与事件

每帧可提供 `foot`、`leftHand`、`rightHand`、`staffGrip`、`staffTip`、`spellOrigin`。攻击和施法关键帧使用 `event: "attack"` 或 `event: "release"`；动画视觉事件不改变网络协议或战斗判定。

## 怪物图集

| 分类 | 帧尺寸 | 基础动画 |
| --- | --- | --- |
| 普通 | 64×64 | idle 4、move 6、attack-windup 4、attack-release 3、hit 3、death 6 |
| 精英 | 96×96 | 基础动画 + channel 4 |
| Boss | 128×128 | 基础动画 + channel、phase、shield、stagger |

遗迹首批稳定 ID：`enemy/chaser`、`enemy/shooter`、`enemy/water-fiend`、`enemy/shield-guard`、`enemy/reflect-warden`、`enemy/resonance-priest`、`enemy/ruin-guardian`。

## 法术、地图与 UI

- 粒子源图按 `8×8` 或 `16×16` 制作；投射物核心按 `16/24/32` 制作。
- 命中特效使用 `64×64`、6–8帧；法阵使用 `96×96` 或 `128×128`。
- 地面源瓦片为 `32×32`，运行时房间装饰网格为64世界单位。
- 元素与装备图标为 `32×32`，状态图标为 `16×16`，目标图标为 `24×24`。
- 所有像素图禁止插值、半透明抗锯齿边缘和非整数像素描边。

## 导入检查

1. 透明边缘无杂色，所有帧尺寸一致。
2. 脚底和手部锚点在整套动画中不漂移。
3. 五方向命名与镜像规则一致。
4. 攻击生效帧和循环区间已写入元数据。
5. 缺失动画仍能回退到程序化表现。
