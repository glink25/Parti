/**
 * parti 事件接线：onState / onEvent 的全部 handler → 驱动 replica、反馈与音效。
 * 权威数据永远以 state 快照为准，事件只做瞬时提示。
 */

import type { DartEventMap, GameState, LobbyErrorReason, ZoneEffect } from '../shared/protocol';
import type { AudioEngine } from './audio';
import type { Feedback } from './feedback';
import { EVENT_TEXT } from './render/hud';
import type { LocalReplica } from './replica';

const LOBBY_ERROR_TEXT: Record<LobbyErrorReason, string> = {
  'not-host': '只有房主能操作',
  'bad-phase': '当前阶段不能这么做',
  'too-few-players': '人数不足，至少 2 人',
  'not-all-ready': '还有玩家未准备',
  'not-finished': '对局还没结束',
  'unknown-player': '玩家状态异常',
};

const ZONE_EFFECT_TEXT: Record<ZoneEffect['kind'], string> = {
  heal: '暖炉祝福：+1♥',
  slow: '冰镇时刻：标靶减速',
  wide: '笨重镖区：下回合镖变宽',
  multishot: '三镖罚单：下回合射 3 镖',
};

export interface NetDeps {
  replica: LocalReplica;
  feedback: Feedback;
  audio: AudioEngine;
  myId(): string;
  playerName(id: string): string;
  now(): number;
  latestState(): GameState | null;
  /** 把提示延迟到世界稳定（上一镖落定、新世界切换完成）后执行 */
  deferUntilSettled(fn: () => void): void;
  /** 收到快照后的 UI 刷新 */
  onState(state: GameState): void;
}

export function createNet(deps: NetDeps): () => void {
  const { replica, feedback, audio } = deps;
  const offs: (() => void)[] = [];

  offs.push(
    parti.onState((raw) => {
      const state = raw as GameState;
      replica.handleSnapshot(state, deps.now());
      deps.onState(state);
    }),
  );

  const on = <E extends keyof DartEventMap & string>(
    event: E,
    handler: (payload: DartEventMap[E]) => void,
  ): void => {
    offs.push(parti.onEvent(event, (p) => handler(p as DartEventMap[E])));
  };

  on('dart:shot-committed', ({ commit, playerId }) => {
    replica.handleRemoteShot(commit, playerId, deps.now());
  });

  on('dart:commit-rejected', () => {
    const state = deps.latestState() ?? (parti.getState() as GameState);
    if (state) replica.handleRejected(state, deps.now());
    feedback.push('提交未通过，已重新同步', 'warn');
  });

  on('dart:turn-granted', ({ turn }) => {
    if (turn.playerId === deps.myId()) audio.play('ready');
  });

  on('dart:round-started', ({ round, durationMs }) => {
    feedback.push(`第 ${round} 轮 · 时限 ${Math.round(durationMs / 1000)}s`, 'info');
  });

  on('dart:zone-triggered', ({ playerId, effect }) => {
    // 事件提示延迟到世界稳定后弹出（落定前不制造「世界突变」观感）
    deps.deferUntilSettled(() => {
      const who = playerId === deps.myId() ? '你' : deps.playerName(playerId);
      feedback.push(`${who}触发 ${ZONE_EFFECT_TEXT[effect.kind]}`, effect.kind === 'heal' ? 'good' : 'info');
    });
  });

  on('dart:health-changed', ({ playerId, delta, reason }) => {
    if (playerId === deps.myId()) return; // 自己的变化已由本地预测反馈
    const name = deps.playerName(playerId);
    if (reason === 'collision') feedback.push(`${name} 碰撞 −1♥`, 'bad');
    else if (delta > 0) feedback.push(`${name} +${delta}♥`, 'good');
  });

  on('dart:player-eliminated', ({ playerId }) => {
    const name = playerId === deps.myId() ? '你' : deps.playerName(playerId);
    feedback.push(`${name}被淘汰！`, 'bad');
    audio.play('eliminated');
  });

  on('dart:timeout', ({ playerId, damage, watchdog }) => {
    if (playerId === deps.myId()) return; // 本地已判
    const name = deps.playerName(playerId);
    feedback.push(`${name} ${watchdog ? '连接超时' : '超时'} −${damage}♥`, 'warn');
    audio.play('timeout');
  });

  on('dart:event', ({ event }) => {
    deps.deferUntilSettled(() => {
      feedback.push(`轮盘事件：${EVENT_TEXT[event.kind]}`, 'info');
      audio.play('event');
    });
  });

  on('dart:game-started', () => {
    feedback.push('游戏开始！', 'good');
  });

  on('dart:game-over', () => {
    audio.play('gameover');
  });

  on('dart:lobby-error', ({ reason }) => {
    feedback.push(LOBBY_ERROR_TEXT[reason] ?? '操作被拒绝', 'warn');
  });

  return () => offs.forEach((off) => off());
}
