import { describe, expect, it } from 'vitest';
import type { BossEncounter } from './contracts';
import { activeBossAfterRestore, canStartBoss, isBossDefeated } from './boss';

const boss = (chunkIndex: number, ordinal: number): NonNullable<BossEncounter> => ({ enemyId: `${chunkIndex}:boss`, bossId: 'storm-warden', ordinal, chunkIndex, hp: 1, maxHp: 1, phaseId: 'phase-1', startedAt: 0, nextAttackAt: 0, sequence: 0, attacks: [], summons: [] });
describe('compact boss lifecycle', () => {
  it('uses an ordinal instead of permanent completion markers', () => { expect(isBossDefeated(1, 11)).toBe(true); expect(isBossDefeated(1, 23)).toBe(false); expect(canStartBoss({ boss: null, completedBossCount: 1 }, 23)).toBe(true); expect(canStartBoss({ boss: null, completedBossCount: 1 }, 11)).toBe(false); });
  it('only permits one active boss and drops completed restores', () => { expect(canStartBoss({ boss: boss(11, 1), completedBossCount: 0 }, 23)).toBe(false); expect(activeBossAfterRestore({ boss: boss(11, 1), completedBossCount: 1 })).toBeNull(); expect(activeBossAfterRestore({ boss: boss(23, 2), completedBossCount: 1 })?.ordinal).toBe(2); });
});
