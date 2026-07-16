export const CATEGORIES = ['entertainment', 'food', 'daily', 'nature', 'campus', 'sports', 'travel', 'nsfw'] as const;
export type Category = typeof CATEGORIES[number];

export const CATEGORY_LABELS: Record<Category, { icon: string; name: string; note: string }> = {
  entertainment: { icon: '✦', name: '娱乐', note: '影视 · 音乐 · 游戏' },
  food: { icon: '♨', name: '美食', note: '主食 · 饮品 · 零食' },
  daily: { icon: '⌂', name: '日常', note: '生活相似物' },
  nature: { icon: '♧', name: '自然', note: '天气 · 地貌 · 植物' },
  campus: { icon: '▤', name: '校园', note: '课堂 · 文具 · 活动' },
  sports: { icon: '●', name: '运动', note: '项目 · 装备 · 赛场' },
  travel: { icon: '➤', name: '旅行', note: '交通 · 景点 · 户外' },
  nsfw: { icon: '♥', name: 'NSFW', note: '含蓄成人向' },
};
