import { build as buildWorker } from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const workerEntry = resolve(import.meta.dirname, 'src/worker/index.ts');

function bundledRoomWorker(outDir: string): Plugin {
  return {
    name: 'bundle-dart-roulette-worker',
    buildStart() {
      this.addWatchFile(workerEntry);
      this.addWatchFile(resolve(import.meta.dirname, 'src/worker/logic.ts'));
      this.addWatchFile(resolve(import.meta.dirname, 'src/shared.ts'));
    },
    async closeBundle() {
      const outfile = resolve(outDir, 'worker.js');
      await buildWorker({
        entryPoints: [workerEntry],
        outfile,
        bundle: true,
        format: 'esm',
        target: 'es2022',
        external: ['@parti/worker-sdk'],
      });

      if (!existsSync(outfile)) throw new Error('Worker bundle was not generated');
      const source = readFileSync(outfile, 'utf8');
      const rewritten = source.replace(/export\s*\{\s*([^\s]+)\s+as\s+default\s*\};?\s*$/, 'export default $1;\n');
      if (!/export default\s+/.test(rewritten)) {
        throw new Error('Worker bundle does not expose a canonical default export');
      }
      writeFileSync(outfile, rewritten);
    },
  };
}

export default defineConfig(({ mode }) => {
  const envName = mode === 'room-dev' ? 'PARTI_ROOM_DEV_OUT_DIR' : 'PARTI_ROOM_BUILD_OUT_DIR';
  const outDir = process.env[envName];
  if (!outDir) throw new Error(`${envName} is required for ${mode}`);

  return {
    plugins: [bundledRoomWorker(outDir)],
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
      target: 'es2022',
    },
  };
});
