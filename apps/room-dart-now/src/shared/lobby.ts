/**
 * 大厅规则与布局辅助（纯函数）。
 */

import { MAX_PLAYERS, MIN_PLAYERS } from './constants';
import type { GamePlayer, LobbyErrorReason } from './protocol';

export interface LobbyReadiness {
  canStart: boolean;
  reason: LobbyErrorReason | null;
  playerCount: number;
  readyCount: number;
}

/**
 * 大厅开局条件：2–8 名 waiting 玩家且全员 ready。
 * （playing/finished 阶段的校验由 Worker 在进入本函数前完成。）
 */
export function lobbyReadiness(players: readonly GamePlayer[]): LobbyReadiness {
  const waiting = players.filter((p) => p.status === 'waiting');
  const readyCount = waiting.filter((p) => p.ready).length;
  if (waiting.length < MIN_PLAYERS || waiting.length > MAX_PLAYERS) {
    return { canStart: false, reason: 'too-few-players', playerCount: waiting.length, readyCount };
  }
  if (readyCount !== waiting.length) {
    return { canStart: false, reason: 'not-all-ready', playerCount: waiting.length, readyCount };
  }
  return { canStart: true, reason: null, playerCount: waiting.length, readyCount };
}

/** 结算排名：胜者优先，再按分数、安全命中数排序 */
export function rankPlayers(players: readonly GamePlayer[], winnerId: string | null): GamePlayer[] {
  return [...players].sort((a, b) => {
    const aw = a.id === winnerId ? 1 : 0;
    const bw = b.id === winnerId ? 1 : 0;
    if (aw !== bw) return bw - aw;
    if (a.score !== b.score) return b.score - a.score;
    return b.stats.safeHits - a.stats.safeHits;
  });
}
