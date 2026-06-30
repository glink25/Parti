import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // 裸名指向 module 构建（自包含、可被 Vite 打包）；
      // 默认 browser 字段会解析到非自包含的 shim 产物，digest 会失败。
      { find: /^webcrypto-liner$/, replacement: 'webcrypto-liner/build/index.es.js' },
    ],
  },
  worker: {
    format: 'es',
  },
});
