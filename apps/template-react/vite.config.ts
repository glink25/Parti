import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const roomDevOutDir = process.env.PARTI_ROOM_DEV_OUT_DIR;
  const roomBuildOutDir = process.env.PARTI_ROOM_BUILD_OUT_DIR;
  if (mode === 'room-dev' && !roomDevOutDir) {
    throw new Error('PARTI_ROOM_DEV_OUT_DIR is required in room-dev mode');
  }
  if (mode === 'room-build' && !roomBuildOutDir) {
    throw new Error('PARTI_ROOM_BUILD_OUT_DIR is required in room-build mode');
  }

  const outDir = mode === 'room-dev'
    ? roomDevOutDir
    : mode === 'room-build'
      ? roomBuildOutDir
      : path.resolve(appDir, 'dist/package');

  return {
    plugins: [react()],
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
  };
});
