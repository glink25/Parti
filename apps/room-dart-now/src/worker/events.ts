/**
 * 随机事件调度：触发节奏与效果应用（见 docs/game-flow.md §7）。
 *
 * 触发时机：每接受一镖 shotsSinceEvent + 1，达到 nextEventAt（3–5 随机）时置
 * eventDue，在下一回合开始前的 advanceTurn 里触发（不打断进行中的回合）。
 */

import {
  EVENT_INTERVAL_MAX,
  EVENT_INTERVAL_MIN,
  MULTISHOT_MAX,
  MULTISHOT_MIN,
  SPEED_UP_FACTOR,
} from '../shared/constants';
import type { EventKind } from '../shared/protocol';
import { pickZoneAngle } from '../shared/rules';
import type { WorkerContext } from './context';

const EVENT_KINDS: readonly EventKind[] = [
  'speed_up',
  'reverse',
  'heal_zone',
  'slow_zone',
  'wide_zone',
  'multishot_zone',
];

export function rollEventInterval(random: () => number): number {
  return EVENT_INTERVAL_MIN + Math.floor(random() * (EVENT_INTERVAL_MAX - EVENT_INTERVAL_MIN + 1));
}

/** 多镖罚单裁定：下回合连续发射 2 或 3 支飞镖 */
export function rollMultishotCount(random: () => number): number {
  return MULTISHOT_MIN + Math.floor(random() * (MULTISHOT_MAX - MULTISHOT_MIN + 1));
}

/** 在 advanceTurn 中调用：rotation 已被归一到新时间轴起点（anchorElapsed = 0） */
export function triggerRandomEvent(ctx: WorkerContext): void {
  const { state } = ctx;

  // 连续两次不出同一事件
  const candidates = EVENT_KINDS.filter((k) => k !== state.lastEventKind);
  const kind = candidates[Math.floor(ctx.random() * candidates.length)];

  // 先按基准重置旋转速度/方向，再叠加事件效果
  let speedFactor = 1;
  let direction: 1 | -1 = 1;
  if (kind === 'speed_up') speedFactor = SPEED_UP_FACTOR;
  if (kind === 'reverse') direction = -1;
  state.rotation = {
    anchorAngle: state.rotation.anchorAngle,
    anchorElapsed: 0,
    speedFactor,
    direction,
  };

  const zoneAngle = kind.endsWith('_zone') ? pickZoneAngle(state.darts, ctx.random) : null;
  state.event = { kind, zoneAngle };
  state.lastEventKind = kind;
  state.shotsSinceEvent = 0;
  state.nextEventAt = rollEventInterval(ctx.random);
  state.eventDue = false;

  ctx.broadcast('dart:event', { event: state.event });
}

/** 事件文案（客户端提示用） */
export const EVENT_COPY: Record<EventKind, string> = {
  speed_up: '烈酒加速',
  reverse: '酒馆反转',
  heal_zone: '暖炉祝福',
  slow_zone: '冰镇时刻',
  wide_zone: '笨重镖区',
  multishot_zone: '多镖罚单',
};
