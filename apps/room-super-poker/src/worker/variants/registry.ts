import type { VariantId, VariantMeta } from '../../game/types';
export type GameVariant={meta:VariantMeta};
export const VARIANTS:Record<VariantId,GameVariant>={
  doudizhu:{meta:{id:'doudizhu',name:'斗地主',minPlayers:3,maxPlayers:3,rules:['固定三人，叫分最高者成为地主','同牌型、同张数才能压过；炸弹和火箭例外','地主先出完则地主胜，否则农民胜']}},
  gandengyan:{meta:{id:'gandengyan',name:'干瞪眼',minPlayers:2,maxPlayers:6,rules:['庄家6张、闲家5张；2人一副牌，3–6人两副','普通牌必须以同牌型恰好大一级接牌，2接A','大小王只能配牌；无人可接时清桌并依次补牌']}},
  chameleon:{meta:{id:'chameleon',name:'变色龙',minPlayers:2,maxPlayers:8,rules:['每人5张，同点数或同花色可以接牌','J是变色龙：出牌时指定下一花色和点数','无牌可出则摸一张；先出完者获胜']}}
};
export const variantList=()=>Object.values(VARIANTS).map(item=>item.meta);
