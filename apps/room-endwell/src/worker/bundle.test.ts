import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadRoomDefinition } from '@parti/worker-sdk';

describe('packaged Endwell worker', () => {
  it('loads through the Parti worker source loader', async () => {
    const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const result = await build({ entryPoints: [path.join(appDir, 'src/worker/index.ts')], bundle: true, write: false, format: 'esm', target: 'es2022', external: ['@parti/worker-sdk'] });
    const source = result.outputFiles[0]!.text.replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/, 'export default $1;');
    const definition = loadRoomDefinition(source); const state = definition.initialState({});
    expect(definition.meta?.name).toBe('Endwell'); expect(state).toMatchObject({ schemaVersion: 5, phase: 'lobby', entities: {}, run: { stage: null } });
  }, 15_000);
});
