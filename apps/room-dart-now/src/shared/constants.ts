/**
 * 全部数值常量的单一来源（见 docs/game-flow.md §2）。
 * 客户端与 Worker 共用；改动任何数值只需改这里。
 */

export const TAU = Math.PI * 2;

/** 第 1 轮每回合总时限 */
export const INITIAL_TURN_MS = 15_000;
/** 每过一整轮回合时限衰减量 */
export const TURN_DECAY_MS = 2_000;
/** 回合时限下限 */
export const MIN_TURN_MS = 5_000;
/** 飞镖飞行时长（逻辑时间，非纯动画） */
export const SHOT_FLIGHT_MS = 520;
/** 客户端重对齐动画时长 */
export const REBASE_MS = 150;
/** 出手方无响应看门狗 */
export const WATCHDOG_MS = 20_000;
/** 标靶基础转速：8 秒/圈 */
export const BASE_ROTATION_MS = 8_000;
/** 标准宽度飞镖的角半径（碰撞与计分基准） */
export const STANDARD_DART_ANGLE = 0.055;
/** 事件奖惩区域的角宽度（36°） */
export const ZONE_ARC = Math.PI / 5;
/** 区域中心采样候选数 */
export const ZONE_CANDIDATES = 16;
/** 初始/上限生命值 */
export const MAX_HEALTH = 3;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** commit 结构校验的统一时间容差 */
export const TIMING_TOLERANCE_MS = 0.5;

/** 随机事件触发节奏：每 3–5 镖一次 */
export const EVENT_INTERVAL_MIN = 3;
export const EVENT_INTERVAL_MAX = 5;

/** slow_zone 命中后的转速/方向 */
export const SLOW_SPEED_FACTOR = 0.7;
/** speed_up 事件后的转速 */
export const SPEED_UP_FACTOR = 1.5;
/** wide_zone 命中者下回合镖宽 */
export const WIDE_WIDTH_FACTOR = 1.5;
/** multishot_zone 命中者下回合镖数范围（含端点），Worker 在命中时随机裁定 */
export const MULTISHOT_MIN = 2;
export const MULTISHOT_MAX = 3;
