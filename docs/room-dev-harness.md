# Room 开发 Harness 与打包规范

本文描述仓库内 `apps/room-*` / `apps/template-*` 如何接入 Parti Web 的开发与生产构建
Harness。新建或修改带构建步骤的 Room 应用时，须满足本文规范，确保 `pnpm room:dev` 与
根目录 `pnpm build` 能正常工作。

Harness 脚本：`scripts/room-app.mjs`、`scripts/room-dev.mjs`、`scripts/room-build.mjs`。

## 快速验证

```bash
pnpm room:dev room-<name>   # 开发：Web + room watch 构建到 apps/web/public/rooms/<output>/
pnpm build                  # 生产：所有 room-* build:room → apps/web/public/rooms/room-* → web build
```

## 项目结构与命名

- 应用目录位于 `apps/room-*`（内置 Room，参与根 `pnpm build`）或 `apps/template-*`（脚手架/示例，仅开发）。
- 必须包含 `public/parti.room.json`；`entry.ui` / `entry.worker` 文件名须与构建产物一致（现有 room 多为 `worker.js`，少数如 `room-tank-battle` 用 `room.worker.js`——以 manifest 为准，二者皆可，但必须自洽）。
- `template-*` 的 manifest `id` 必须以 `dev-` 开头（由 `scripts/room-app.mjs` 校验）。

## package.json 脚本

| 脚本 | 谁需要 | 作用 |
| --- | --- | --- |
| `dev:room` | `room-*` 与 `template-*` | 被根命令 `pnpm room:dev <app>` 调用 |
| `build:room` | 仅 `room-*` | 被根命令 `pnpm build` 调用 |

推荐写法（参考 `apps/room-undercover/package.json`）：

```json
"dev:room": "vite build --watch --mode room-dev",
"build:room": "vite build --mode room-build && node scripts/check-worker-contract.mjs"
```

- **不要**在 room 项目里硬编码 `apps/web/public/rooms/...` 路径；输出目录由 Harness 通过环境变量 `PARTI_ROOM_DEV_OUT_DIR` / `PARTI_ROOM_BUILD_OUT_DIR` 注入。

## Vite 构建与 Room Package 产物

`vite.config.ts` 须实现（参考 `apps/room-undercover/vite.config.ts`）：

- `room-dev` 模式读取 `PARTI_ROOM_DEV_OUT_DIR`；`room-build` 模式读取 `PARTI_ROOM_BUILD_OUT_DIR`；缺省则抛错。
- `build.outDir` 指向上述目录；`emptyOutDir: true`；`assetsInlineLimit: 0`（filesystem package 需要独立静态资源文件）。
- Vite 负责 UI 入口（根目录 `index.html` → 打包 JS/CSS）并自动复制 `public/`（含 `parti.room.json`、封面图等）。
- Worker **不能**依赖 Vite 默认多文件输出；须在 Vite plugin 的 `closeBundle` 中用 **esbuild 单独打包**为 manifest 声明的 worker 文件：
  - `bundle: true`，`format: 'esm'`，`target: 'es2022'`
  - `external: ['@parti/worker-sdk']`（运行时由 Parti loader 注入 `defineRoom`）
  - 将 esbuild 产物的 `export { X as default }` 改写为 `export default X`（loader 兼容要求）
  - `buildStart` 中对 worker 源码及纯逻辑依赖文件调用 `addWatchFile`，保证 `dev:room --watch` 能增量重建

完整产物 = manifest 中 `entry` 声明的全部文件（至少 `parti.room.json`、`index.html`、worker 文件）。

## Worker 打包产物契约

Worker 入口通常为 `src/worker/index.ts` 或 `src/worker.ts`；运行时加载的是**打包后的单文件**。
运行时 API 见 [worker-api.md](./worker-api.md)；打包侧额外要求：

- **必须** `export default defineRoom({...})` 或 `export default createFlowRoom(...)`（Flow 房间见 `apps/room-skyward/src/worker/index.ts`）。
- `initialState` 必须是函数。
- 产物中**不得**保留相对路径 import（`from './...'`）；所有游戏逻辑须 bundle 进 worker 单文件。
- 产物中须保留 canonical import（供 loader 剥离后注入）：`import { defineRoom } from '@parti/worker-sdk';`。`@parti/flow/worker` 的 import 会被 bundle 掉，不进入最终文件。
- 建议在 `build:room` 后运行 `scripts/check-worker-contract.mjs`（worker 文件名随 manifest `entry.worker` 调整），或像 `apps/room-skyward/src/worker/bundle.test.ts` 一样用 `loadRoomDefinition` 做 bundle 测试。

## 相关文档

- [getting-started.md § 开发仓库内的 Room 应用](./getting-started.md#开发仓库内的-room-应用) — Harness 使用方式与两类应用说明
- [worker-api.md](./worker-api.md) — Worker 运行时 API 与 loader 约束
- [manifest.md](./manifest.md) — `parti.room.json` 字段参考
