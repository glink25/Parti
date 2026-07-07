import { describe, expect, it } from 'vitest';
import { BOSSES, GENERATION_VERSION, MONSTERS, STAGES, THEMES, deriveSeed, deriveStageSeed, generateStage, isWalkable, roomAt } from './roguelike';

describe('deterministic roguelike blueprint', () => {
  it('reproduces every seeded subsystem exactly', () => {
    expect(generateStage(0x12345678, 0)).toEqual(generateStage(0x12345678, 0));
  });

  it('isolates three stage seeds and generated content', () => {
    const stages = STAGES.map((_, index) => generateStage(91, index));
    expect(new Set(stages.map((stage) => stage.stageSeed))).toHaveLength(3);
    expect(new Set(stages.map((stage) => stage.fingerprint))).toHaveLength(3);
    expect(stages.map((stage) => stage.difficulty)).toEqual([1, 1.28, 1.62]);
    expect(stages.every((stage) => stage.themeId === 'ruins' && stage.bossDefinitionId === 'ruins.guardian')).toBe(true);
  });

  it('keeps named random domains independent', () => {
    const seed = deriveStageSeed(42, 1);
    expect(deriveSeed(seed, 'terrain')).not.toBe(deriveSeed(seed, 'merchant'));
    expect(deriveSeed(seed, 'encounters')).not.toBe(deriveSeed(seed, 'rewards'));
  });

  it('creates a connected fourteen-room map with fixed special terrain', () => {
    const stage = generateStage(77, 0), visited = new Set(['room-0']), queue = ['room-0'];
    while (queue.length) { const id = queue.shift()!, room = stage.world.rooms.find((candidate) => candidate.id === id)!; for (const next of room.connections) if (!visited.has(next)) { visited.add(next); queue.push(next); } }
    expect(stage.generationVersion).toBe(GENERATION_VERSION);
    expect(stage.world.rooms).toHaveLength(14);
    expect(visited.size).toBe(14);
    expect(isWalkable(stage, stage.world.spawn)).toBe(true);
    expect(roomAt(stage, stage.world.spawn)?.id).toBe('room-0');
    expect(stage.terrains.some((terrain) => terrain.kind === 'safe-zone')).toBe(true);
    for (const terrain of stage.terrains) expect(stage.world.rooms.find((room) => room.id === terrain.roomId)).toBeDefined();
  });

  it('exposes replaceable theme, monster, boss and stage definitions', () => {
    expect(THEMES.ruins.monsterPool.every((id) => MONSTERS[id])).toBe(true);
    expect(BOSSES['ruins.guardian']?.monsterId).toBe('ruins.boss');
    expect(STAGES).toHaveLength(3);
  });
  it('places merchants and forges in distinct clear floor areas', () => { for (let seed = 0; seed < 40; seed++) { const stage = generateStage(seed, seed % 3), merchantRoom = roomAt(stage, stage.merchant.position)?.id, forgeRoom = roomAt(stage, stage.forge.position)?.id; expect(merchantRoom).toBeDefined(); expect(forgeRoom).toBeDefined(); expect(merchantRoom).not.toBe(forgeRoom); expect(isWalkable(stage, stage.merchant.position, stage.merchant.radius)).toBe(true); expect(isWalkable(stage, stage.forge.position, stage.forge.radius)).toBe(true); } });
});
