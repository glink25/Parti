import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));
function files(dir: string): string[] { return readdirSync(dir).flatMap((name) => { const file = path.join(dir, name); return statSync(file).isDirectory() ? files(file) : [file]; }); }
function workerBundle(outDir: string): Plugin {
  return { name: 'endwell-worker', buildStart() { for (const dir of ['worker', 'game', 'content']) for (const file of files(path.join(appDir, 'src', dir))) this.addWatchFile(file); }, async closeBundle() {
    const outfile = path.join(outDir, 'worker.js');
    await esbuild({ entryPoints: [path.join(appDir, 'src/worker/index.ts')], outfile, bundle: true, format: 'esm', target: 'es2022', sourcemap: true, external: ['@parti/worker-sdk'] });
    writeFileSync(outfile, readFileSync(outfile, 'utf8').replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/, 'export default $1;'));
  } };
}
export default defineConfig(({ mode }) => { const fallback = path.join(appDir, 'dist/package'); const outDir = mode === 'room-dev' ? process.env.PARTI_ROOM_DEV_OUT_DIR ?? fallback : mode === 'room-build' ? process.env.PARTI_ROOM_BUILD_OUT_DIR ?? fallback : fallback; return { plugins: [workerBundle(outDir)], build: { outDir, emptyOutDir: true, assetsInlineLimit: 0 } }; });
