import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'build-room-worker',
    async closeBundle() {
      await build({ entryPoints: [resolve('src/worker.ts')], outfile: resolve('dist/worker.js'), bundle: true, format: 'esm', platform: 'browser', external: ['@parti/worker-sdk'] });
      await mkdir(resolve('dist'), { recursive: true });
      await copyFile(resolve('public/parti.room.json'), resolve('dist/parti.room.json'));
    },
  }],
  build: { outDir: 'dist', emptyOutDir: true },
});
