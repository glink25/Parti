# 云端远征 2

完全随机、种子确定、可注册内容策略的 1–4 人无限平台跳跃游戏。客户端使用 LittleJS 驱动循环与 Canvas，以轻量数字水粉背景和程序化手绘角色、平台、道具及特效呈现完整游戏美术。

## 美术与体积

三个生态层使用压缩背景图并在层间交叉淡化；玩家、怪物、Boss 和增益使用两张透明图集，平台与动态特效由 Canvas 实时绘制。生产包必须保持在 5 MB 以内。

## 扩展内容

新平台、怪物、增益、Boss 或遭遇分别实现 `src/game/contracts.ts` 中的策略接口，并在 `src/content/index.ts` 注册。生成策略必须只使用 `GenerationContext.rng(channel)`，不得使用 `Math.random()` 或当前时间。

普通区块由 `generation.ts` 逐平台采样并以真实物理验证主路线，不使用模板。静态地图由所有节点按种子生成；玩家改变的实体状态由 Worker 保存。

## 开发

```sh
pnpm room:dev room-skyward-2
pnpm --filter @parti/room-skyward-2 test
pnpm --filter @parti/room-skyward-2 typecheck
```
