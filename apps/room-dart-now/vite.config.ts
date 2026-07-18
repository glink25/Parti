import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function workerBundle(outDir: string): Plugin {
  const workerEntry = path.resolve(appDir, 'src/worker/index.ts');
  const watchFiles = [
    ...collectSources(path.resolve(appDir, 'src/worker')),
    ...collectSources(path.resolve(appDir, 'src/shared')),
  ];

  return {
    name: 'parti-worker-bundle',
    buildStart() {
      for (const file of watchFiles) this.addWatchFile(file);
    },
    async closeBundle() {
      // vitest 会加载本 config 并在关闭 dev server 时触发 closeBundle——测试不需要 worker 产物
      if (process.env.VITEST) return;
      const outfile = path.join(outDir, 'worker.js');
      await esbuild({
        entryPoints: [workerEntry],
        outfile,
        bundle: true,
        format: 'esm',
        target: 'es2022',
        sourcemap: true,
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
    plugins: [workerBundle(outDir)],
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
  };
});
