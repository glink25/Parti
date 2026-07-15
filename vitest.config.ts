import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
      '@parti/core': pkg('core'),
      '@parti/transport-local': pkg('transport-local'),
      '@parti/transport-lan': pkg('transport-lan'),
      '@parti/worker-sdk': pkg('worker-sdk'),
      '@parti/room-packager': pkg('room-packager'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'supabase/**/*.test.ts'],
  },
});
