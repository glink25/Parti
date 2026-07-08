import { describe, expect, it } from 'vitest';
import { generateStage } from '../roguelike';
import { initialState, testMonster } from './state';
import { canPlaceObstacle, resolveTeleportDestination, resolveWorldMovement } from './worldCollision';

function setup() { const state = initialState(), stage = state.run.stage = generateStage(12, 0), spawn = stage.world.spawn, wall = testMonster(0); wall.id = 'wall:test'; wall.kind = 'wall'; wall.position = { x: spawn.x + 95, y: spawn.y }; wall.radius = 20; wall.obstacle = { blocksMovement: true, blocksProjectile: true, blocksBeam: true, blocksSpray: false, material: 'stone', width: 36, height: 140 }; state.entities[wall.id] = wall; return { state, stage, spawn, wall }; }

describe('shared world collision', () => {
  it('stops players and monsters at dynamic obstacle entities', () => { const { state, spawn } = setup(), desired = { x: spawn.x + 180, y: spawn.y }; expect(resolveWorldMovement(state, spawn, desired, 24, 'p1').x).toBeLessThan(desired.x); expect(resolveWorldMovement(state, spawn, desired, 31, 'monster').x).toBeLessThan(desired.x); });
  it('restores passage as soon as a wall is destroyed', () => { const { state, spawn, wall } = setup(), desired = { x: spawn.x + 180, y: spawn.y }; delete state.entities[wall.id]; expect(resolveWorldMovement(state, spawn, desired, 24, 'p1')).toEqual(desired); });
  it('rejects wall placement in corridors and accepts open room space', () => { const { state, stage, spawn } = setup(), corridor = stage.world.corridors[0]!; expect(canPlaceObstacle(state, { x: corridor.position.x + corridor.width / 2, y: corridor.position.y + corridor.height / 2 }, 36, 140, 'p1')).toBe(false); delete state.entities['wall:test']; expect(canPlaceObstacle(state, { x: spawn.x + 180, y: spawn.y + 150 }, 36, 140, 'p1')).toBe(true); });
  it('teleports to the farthest safe point before an obstacle', () => { const { state, spawn, wall } = setup(), target = { x: spawn.x + 180, y: spawn.y }, landed = resolveTeleportDestination(state, spawn, target, 24, 'p1'); expect(landed.x).toBeLessThan(wall.position.x - 20); expect(landed.x).toBeGreaterThan(spawn.x); });
  it('does not teleport into an active sealed room', () => { const { state, stage, spawn } = setup(), encounter = stage.encounters.find((candidate) => candidate.kind === 'sealed')!; encounter.status = 'active'; const room = stage.world.rooms.find((candidate) => candidate.id === encounter.roomId)!, target = { x: room.position.x + room.width / 2, y: room.position.y + room.height / 2 }, landed = resolveTeleportDestination(state, spawn, target, 24, 'p1'); expect(landed).not.toEqual(target); });
});
