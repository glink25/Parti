import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: [
      // 裸名指向 module 构建（自包含、可被 Vite 打包）；
      // 默认 browser 字段会解析到非自包含的 shim 产物，digest 会失败。
      { find: /^webcrypto-liner$/, replacement: 'webcrypto-liner/build/index.es.js' },
    ],
  },
  worker: {
    format: 'es',
  },
});
