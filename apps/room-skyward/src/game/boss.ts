import type { BossEncounter, GameState } from './contracts';
import { bossOrdinalForChunk, isBossChunk } from './generation';

export function isBossDefeated(completedBossCount: number, chunkIndex: number) { return bossOrdinalForChunk(chunkIndex) <= completedBossCount; }
export function canStartBoss(state: Pick<GameState, 'boss' | 'completedBossCount'>, chunkIndex: number) { return !state.boss && isBossChunk(chunkIndex) && !isBossDefeated(state.completedBossCount, chunkIndex); }
export function activeBossAfterRestore(state: Pick<GameState, 'boss' | 'completedBossCount'>): BossEncounter { return state.boss && !isBossDefeated(state.completedBossCount, state.boss.chunkIndex) ? state.boss : null; }
