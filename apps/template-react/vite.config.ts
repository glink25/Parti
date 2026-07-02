import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const roomDevOutDir = process.env.PARTI_ROOM_DEV_OUT_DIR;
  if (mode === 'room-dev' && !roomDevOutDir) {
    throw new Error('PARTI_ROOM_DEV_OUT_DIR is required in room-dev mode');
  }

  return {
    plugins: [react()],
    build: {
      outDir: mode === 'room-dev' ? roomDevOutDir : path.resolve(appDir, 'dist/package'),
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
  };
});
