import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadRoomDefinition } from '@parti/worker-sdk';
import { PARTI_FLOW_PAYLOAD } from '@parti/flow';

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
      schemaVersion: 2,
      phase: 'lobby',
    });
    const host = { id: 'host', name: 'Host', role: 'host' as const }, state = definition.initialState({});
    const context = { state, players: [host], host, now: () => 1000, random: () => .25, broadcast() {}, send() {}, kick() {}, log() {}, setTimer() {}, clearTimer() {} };
    definition.onCreate?.(context); definition.onJoin?.(context, host);
    definition.actions?.setReady?.(context, { player: host, actionId: 'ready:1', payload: { [PARTI_FLOW_PAYLOAD]: { id: 'host:1', type: 'setReady', payload: { ready: true }, from: 'host', seq: 1, origin: 'local', createdAt: 1 } } });
    expect(state).toMatchObject({ phase: 'running', hostId: 'host', startedPlayers: ['host'] });
  });
});
