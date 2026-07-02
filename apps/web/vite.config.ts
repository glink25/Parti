import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 在构建/开发期扫描 public/rooms/ 下的内置模板，生成虚拟模块 `virtual:room-registry`。
 * 模板源文件继续静态托管于 public/（运行时由 loadPackageFromUrl 抓取），新增模板只需放一个
 * 含 parti.room.json 的目录即可，无需改代码。直接用 fs 读取，绕开 Vite「public 资源不可被 JS
 * 导入」的限制（import.meta.glob 对 public 在 dev 下会报错）。
 */
function roomRegistryPlugin(): Plugin {
  const virtualId = 'virtual:room-registry';
  const resolvedId = `\0${virtualId}`;
  const roomsDir = path.resolve(__dirname, 'public/rooms');

  function readRegistry(): string {
    const dirs = fs.existsSync(roomsDir)
      ? fs.readdirSync(roomsDir, { withFileTypes: true }).filter((e) => e.isDirectory())
      : [];
    const entries = dirs.flatMap((entry) => {
      const manifestPath = path.join(roomsDir, entry.name, 'parti.room.json');
      if (!fs.existsSync(manifestPath)) return [];
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const files: string[] = [];
      const collect = (current: string, prefix = '') => {
        for (const child of fs.readdirSync(current, { withFileTypes: true })) {
          const relative = prefix ? `${prefix}/${child.name}` : child.name;
          if (child.isDirectory()) collect(path.join(current, child.name), relative);
          else if (child.isFile()) files.push(relative);
        }
      };
      collect(path.dirname(manifestPath));
      return [{ dir: entry.name, manifest, files: files.sort() }];
    });
    return `export const rooms = ${JSON.stringify(entries)};`;
  }

  return {
    name: 'parti-room-registry',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) return readRegistry();
    },
    configureServer(server) {
      // dev 下增删模板目录或改 manifest 时，让虚拟模块失效以触发热更新。
      server.watcher.add(roomsDir);
      let reloadTimer: ReturnType<typeof setTimeout> | undefined;
      const invalidate = (file: string) => {
        if (file !== roomsDir && !file.startsWith(`${roomsDir}${path.sep}`)) return;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = undefined;
          const mod = server.moduleGraph.getModuleById(resolvedId);
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }, 150);
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
      server.watcher.on('change', invalidate);
      server.httpServer?.once('close', () => {
        if (reloadTimer) clearTimeout(reloadTimer);
      });
    },
  };
}

/** 从 GA_MEASUREMENT_SNIPPET 环境变量注入 head 内 analytics 片段，源码中不包含 GA 代码。 */
function gaSnippetPlugin(): Plugin {
  let snippet = '';

  return {
    name: 'parti-ga-snippet',
    config(_, { mode }) {
      const env = loadEnv(mode, __dirname, '');
      snippet = env.GA_MEASUREMENT_SNIPPET?.trim() ?? '';
    },
    transformIndexHtml(html) {
      if (!snippet) return html;
      return html.replace('</head>', `  ${snippet}\n</head>`);
    },
  };
}

export default defineConfig({
  plugins: [roomRegistryPlugin(), gaSnippetPlugin(), react(), tailwindcss()],
  server: { port: 5157 },
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
