import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

function workerBundle(outDir: string): Plugin {
  const workerFiles = [
    path.resolve(appDir, 'src/worker/index.ts'),
    path.resolve(appDir, 'src/game/definition.ts'),
    path.resolve(appDir, 'src/game/contracts.ts'),
    path.resolve(appDir, 'src/game/maps.ts'),
    path.resolve(appDir, 'src/game/rules.ts'),
  ];

  return {
    name: 'parti-worker-bundle',
    buildStart() {
      for (const file of workerFiles) this.addWatchFile(file);
    },
    async closeBundle() {
      const outfile = path.join(outDir, 'room.worker.js');
      await esbuild({
        entryPoints: [workerFiles[0]],
        outfile,
        bundle: true,
        format: 'esm',
        target: 'es2022',
        sourcemap: true,
        minify: false,
        external: ['@parti/worker-sdk'],
      });
      const source = readFileSync(outfile, 'utf8');
      writeFileSync(
        outfile,
        source.replace(
          /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/,
          'export default $1;',
        ),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const dev = process.env.PARTI_ROOM_DEV_OUT_DIR;
  const prod = process.env.PARTI_ROOM_BUILD_OUT_DIR;
  if (mode === 'room-dev' && !dev) throw new Error('PARTI_ROOM_DEV_OUT_DIR is required');
  if (mode === 'room-build' && !prod) throw new Error('PARTI_ROOM_BUILD_OUT_DIR is required');
  const outDir = mode === 'room-dev'
    ? dev!
    : mode === 'room-build'
      ? prod!
      : path.resolve(appDir, 'dist/package');

  return {
    base: './',
    plugins: [workerBundle(outDir)],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
    },
  };
});
