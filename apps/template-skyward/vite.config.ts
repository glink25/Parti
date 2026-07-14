import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? listFiles(file) : [file];
  });
}

function partiWorkerBundle(outDir: string): Plugin {
  const workerDir = path.resolve(appDir, 'src/worker');
  const gameDir = path.resolve(appDir, 'src/game');
  return {
    name: 'parti-worker-bundle',
    buildStart() {
      for (const file of [...listFiles(workerDir), ...listFiles(gameDir)]) this.addWatchFile(file);
    },
    async closeBundle() {
      const outfile = path.join(outDir, 'worker.js');
      await esbuild({
        entryPoints: [path.join(workerDir, 'index.ts')],
        outfile,
        bundle: true,
        format: 'esm',
        target: 'es2022',
        sourcemap: true,
        external: ['@parti/worker-sdk'],
      });
      const source = readFileSync(outfile, 'utf8');
      writeFileSync(outfile, source.replace(
        /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/,
        'export default $1;',
      ));
    },
  };
}

export default defineConfig(({ mode }) => {
  const devOut = process.env.PARTI_ROOM_DEV_OUT_DIR;
  const buildOut = process.env.PARTI_ROOM_BUILD_OUT_DIR;
  if (mode === 'room-dev' && !devOut) throw new Error('PARTI_ROOM_DEV_OUT_DIR is required');
  if (mode === 'room-build' && !buildOut) throw new Error('PARTI_ROOM_BUILD_OUT_DIR is required');
  const outDir = mode === 'room-dev' ? devOut! : mode === 'room-build' ? buildOut! : path.resolve(appDir, 'dist/package');
  return { plugins: [partiWorkerBundle(outDir)], build: { outDir, emptyOutDir: true, assetsInlineLimit: 0 } };
});
