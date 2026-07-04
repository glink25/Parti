import { describe, expect, it } from 'vitest';
import type { BossEncounter, GameState } from './contracts';
import { activeBossAfterRestore, bossDefeatedKey, canStartBoss, isBossDefeated } from './boss';

const boss = (chunkIndex: number): NonNullable<BossEncounter> => ({ enemyId: `${chunkIndex}:boss`, chunkIndex, hp: 1, maxHp: 1, startedAt: 0, nextAttackAt: 0, sequence: 0, attacks: [], summons: [] });
const state = (active: BossEncounter, entities: GameState['entities'] = {}) => ({ boss: active, entities });

describe('boss lifecycle', () => {
  it('never starts a completed boss again', () => {
    const chunk = 9; const entities = { [bossDefeatedKey(chunk)]: { activatedUntil: Number.MAX_SAFE_INTEGER } };
    expect(isBossDefeated(entities, chunk)).toBe(true); expect(canStartBoss(state(null, entities), chunk)).toBe(false);
  });
  it('allows later boss chunks after an earlier boss is complete', () => {
    const entities: GameState['entities'] = {};
    for (const chunk of [9, 19, 29]) { expect(canStartBoss(state(null, entities), chunk)).toBe(true); entities[bossDefeatedKey(chunk)] = { activatedUntil: Number.MAX_SAFE_INTEGER }; expect(canStartBoss(state(null, entities), chunk)).toBe(false); }
    expect(canStartBoss(state(boss(29), entities), 39)).toBe(false);
  });
  it('drops a restored boss that already has a completion marker', () => {
    const entities = { [bossDefeatedKey(9)]: { activatedUntil: Number.MAX_SAFE_INTEGER } };
    expect(activeBossAfterRestore(state(boss(9), entities))).toBeNull(); expect(activeBossAfterRestore(state(boss(19), entities))?.chunkIndex).toBe(19);
  });
});
