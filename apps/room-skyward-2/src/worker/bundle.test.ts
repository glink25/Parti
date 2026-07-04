import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadRoomDefinition } from '@parti/worker-sdk';

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
  });
});
