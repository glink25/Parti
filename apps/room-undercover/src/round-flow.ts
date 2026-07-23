// 纯逻辑：谁是卧底的发言顺序与投票聚合。无副作用，可被 worker bundle 并单测。

/**
 * 按发牌顺序返回本轮仍存活玩家的发言序列，从 startAt（相对存活列表的偏移）开始环形排列。
 */
export function livingSpeakingOrder(dealtOrder: string[], eliminated: string[], startAt = 0): string[] {
  const eliminatedSet = new Set(eliminated);
  const living = dealtOrder.filter((id) => !eliminatedSet.has(id));
  if (living.length === 0) return [];
  const start = ((startAt % living.length) + living.length) % living.length;
  return [...living.slice(start), ...living.slice(0, start)];
}

/** 统计每个被投目标的票数。忽略空目标。 */
export function tallyVotes(votes: Record<string, string>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) {
    if (!target) continue;
    tally[target] = (tally[target] ?? 0) + 1;
  }
  return tally;
}

/** 返回并列最高票的目标 id 列表（无有效票时为空）。 */
export function voteLeaders(tally: Record<string, number>): string[] {
  let max = 0;
  for (const count of Object.values(tally)) if (count > max) max = count;
  if (max === 0) return [];
  return Object.keys(tally).filter((id) => tally[id] === max);
}

export type VoteOutcome = {
  /** 并列最高票者。 */
  leaders: string[];
  /** 唯一最高票者的 id；平票或无票时为 null。 */
  eliminatedId: string | null;
  /** 是否出现并列最高票（需重投或跳过）。 */
  tie: boolean;
};

/**
 * 结算一轮投票：只统计投给合法候选者的票。
 * 单一最高票 -> eliminatedId；并列 -> tie=true 且 leaders 为并列者，由调用方决定重投或本轮不淘汰。
 */
export function resolveVote(votes: Record<string, string>, candidateIds: string[]): VoteOutcome {
  const candidateSet = new Set(candidateIds);
  const valid: Record<string, string> = {};
  for (const [voterId, targetId] of Object.entries(votes)) {
    if (candidateSet.has(targetId)) valid[voterId] = targetId;
  }
  const leaders = voteLeaders(tallyVotes(valid));
  if (leaders.length === 1) return { leaders, eliminatedId: leaders[0]!, tie: false };
  return { leaders, eliminatedId: null, tie: leaders.length > 1 };
}
