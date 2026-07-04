import type { BossEncounter, DynamicEntityState, GameState } from './contracts';
import { isBossChunk } from './generation';

export function bossDefeatedKey(chunkIndex: number) { return `boss-defeated:${chunkIndex}`; }
export function isBossDefeated(entities: Record<string, DynamicEntityState>, chunkIndex: number) { return (entities[bossDefeatedKey(chunkIndex)]?.activatedUntil ?? 0) > 0; }
export function canStartBoss(state: Pick<GameState, 'boss' | 'entities'>, chunkIndex: number) { return !state.boss && isBossChunk(chunkIndex) && !isBossDefeated(state.entities, chunkIndex); }
export function activeBossAfterRestore(state: Pick<GameState, 'boss' | 'entities'>): BossEncounter { return state.boss && !isBossDefeated(state.entities, state.boss.chunkIndex) ? state.boss : null; }
