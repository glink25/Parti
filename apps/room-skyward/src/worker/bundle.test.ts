import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadRoomDefinition } from '@parti/worker-sdk';
import { PARTI_FLOW_PAYLOAD } from '@parti/flow';
import { BOSS_ARENA_FLOOR_OFFSET, BOSS_TRIGGER_OFFSET, CHUNK_HEIGHT } from '../game/contracts';

describe('packaged worker', () => {
  it('can be evaluated by the Parti source loader', async () => {
    const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const result = await build({
      entryPoints: [path.join(appDir, 'src/worker/index.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      external: ['@parti/worker-sdk'],
    });
    const source = result.outputFiles[0]!.text.replace(
      /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/,
      'export default $1;',
    );
    const definition = loadRoomDefinition(source);
    expect(definition.meta?.name).toBe('云端远征 2');
    expect(definition.initialState({})).toMatchObject({
      schemaVersion: 3,
      phase: 'lobby',
    });
    const host = { id: 'host', name: 'Host', role: 'host' as const }, state = definition.initialState({});
    const context = { state, players: [host], host, now: () => 1000, random: () => .25, broadcast() {}, send() {}, kick() {}, log() {}, setTimer() {}, clearTimer() {} };
    definition.onCreate?.(context); definition.onJoin?.(context, host);
    definition.actions?.setReady?.(context, { player: host, actionId: 'ready:1', payload: { [PARTI_FLOW_PAYLOAD]: { id: 'host:1', type: 'setReady', payload: { ready: true }, from: 'host', seq: 1, origin: 'local', createdAt: 1 } } });
    expect(state).toMatchObject({ phase: 'running', hostId: 'host', startedPlayers: ['host'] });
    const triggerY = 11 * CHUNK_HEIGHT + BOSS_TRIGGER_OFFSET;
    state.players.host!.effects.rocket = { id: 'rocket', startedAt: 0, endsAt: 6500, stacks: 1, sourceId: 'test' };
    definition.actions?.publishPose?.(context, { player: host, actionId: 'pose:1', payload: { [PARTI_FLOW_PAYLOAD]: { id: 'host:2', type: 'publishPose', payload: { sequence: 1, x: 450, y: triggerY + 500, vy: 1050, cameraBottom: triggerY - 500, direction: 0 }, from: 'host', seq: 2, origin: 'local', createdAt: 2 } } });
    expect(state.players.host).toMatchObject({ y: triggerY, vy: 0, effects: { rocket: { phase: 'ending', forcedEndingAt: 1000 } } });
    expect(state.teamVoidY).toBe(11 * CHUNK_HEIGHT + BOSS_ARENA_FLOOR_OFFSET);
    expect(state.players.host!.cameraBottom).toBe(state.teamVoidY);

    delete state.players.host!.effects.rocket;
    definition.actions?.playerOutcome?.(context, { player: host, actionId: 'outcome:1', payload: { [PARTI_FLOW_PAYLOAD]: { id: 'host:3', type: 'playerOutcome', payload: { eventId: 'host:death:1', sequence: 1, outcome: 'death', reason: 'test' }, from: 'host', seq: 3, origin: 'local', createdAt: 3 } } });
    expect(state).toMatchObject({ phase: 'gameover', players: { host: { alive: false, positionEpoch: 1 } } });

    definition.actions?.restart?.(context, { player: host, actionId: 'restart:1', payload: { [PARTI_FLOW_PAYLOAD]: { id: 'host:4', type: 'restart', payload: null, from: 'host', seq: 4, origin: 'local', createdAt: 4 } } });
    expect(state).toMatchObject({ phase: 'lobby', players: { host: { alive: true, ready: false, positionEpoch: 1 } } });
    definition.actions?.setReady?.(context, { player: host, actionId: 'ready:2', payload: { [PARTI_FLOW_PAYLOAD]: { id: 'host:5', type: 'setReady', payload: { ready: true }, from: 'host', seq: 5, origin: 'local', createdAt: 5 } } });
    expect(state).toMatchObject({ phase: 'running', startedPlayers: ['host'], players: { host: { alive: true, x: 450, y: 120, positionEpoch: 2 } } });
  });
});
