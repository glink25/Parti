import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@parti/core': pkg('core'),
      '@parti/transport-local': pkg('transport-local'),
      '@parti/worker-sdk': pkg('worker-sdk'),
      '@parti/room-packager': pkg('room-packager'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
  },
});
