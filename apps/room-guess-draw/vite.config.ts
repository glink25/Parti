import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

function workerBundle(outDir: string): Plugin {
  const workerFiles = [
    path.resolve(appDir, 'src/worker.ts'),
    path.resolve(appDir, 'src/canvas-budget.ts'),
    path.resolve(appDir, 'src/game-logic.ts'),
    path.resolve(appDir, 'src/stroke-update.ts'),
  ];

  return {
    name: 'parti-worker-bundle',
    buildStart() {
      for (const file of workerFiles) this.addWatchFile(file);
    },
    async closeBundle() {
      const outfile = path.join(outDir, 'worker.js');
      await esbuild({ entryPoints: [workerFiles[0]], outfile, bundle: true, format: 'esm', target: 'es2022', sourcemap: true, external: ['@parti/worker-sdk'] });
      const source = readFileSync(outfile, 'utf8');
      writeFileSync(outfile, source.replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/, 'export default $1;'));
    },
  };
}

function roomVendorChunk(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined;
  if (
    id.includes('/node_modules/react/') ||
    id.includes('/node_modules/react-dom/') ||
    id.includes('/node_modules/scheduler/')
  ) {
    return 'react-vendor';
  }
  if (
    id.includes('/node_modules/konva/') ||
    id.includes('/node_modules/react-konva/') ||
    id.includes('/node_modules/react-reconciler/') ||
    id.includes('/node_modules/its-fine/')
  ) {
    return 'canvas-vendor';
  }
  return undefined;
}

export default defineConfig(({ mode }) => {
  const dev = process.env.PARTI_ROOM_DEV_OUT_DIR;
  const prod = process.env.PARTI_ROOM_BUILD_OUT_DIR;
  if (mode === 'room-dev' && !dev) throw new Error('PARTI_ROOM_DEV_OUT_DIR is required');
  if (mode === 'room-build' && !prod) throw new Error('PARTI_ROOM_BUILD_OUT_DIR is required');
  const outDir = mode === 'room-dev' ? dev! : mode === 'room-build' ? prod! : path.resolve(appDir, 'dist/package');
  return {
    plugins: [react(), workerBundle(outDir)],
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
      rollupOptions: { output: { manualChunks: roomVendorChunk } },
    },
  };
});
