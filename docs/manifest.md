# Manifest 参考（`parti.room.json`）

每个房间根目录必须有一个 `parti.room.json`，声明房间元信息和入口文件。
Runtime 加载房间时会先校验它（校验失败抛 `ManifestError`）。

源码：`packages/room-packager/src/manifest.ts`。

## 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `partiVersion` | `string` | ✅ | Parti 版本，非空字符串。官方示例用 `"0.1.0"`。 |
| `protocolVersion` | `number` | ✅ | 协议版本号，当前为 `1`。 |
| `id` | `string` | ✅ | 房间唯一标识，非空。 |
| `name` | `string` | ✅ | 显示名称，非空。 |
| `version` | `string` | ✅ | 房间包版本，非空。 |
| `packageMode` | `'blob' \| 'filesystem'` | ✅ | UI URL 加载模式；单文件使用 `blob`，包内静态站点使用 `filesystem`。 |
| `entry.ui` | `string` | ✅ | UI 入口文件名，如 `"index.html"`。 |
| `entry.worker` | `string` | ✅ | 逻辑入口文件名，如 `"room.worker.js"`。 |
| `entry.client` | `string` | | 可选的额外客户端脚本。 |
| `entry.style` | `string` | | 可选的样式表。 |
| `description` | `string` | | 房间描述。 |
| `tags` | `string[]` | | 编辑器分类 tagId；必须为非空、无重复字符串。未知 tagId 由界面原样显示。 |
| `author` | `{ name?: string }` | | 作者信息。 |
| `room.minPlayers` | `number` | | 最少玩家数。 |
| `room.maxPlayers` | `number` | | 最多玩家数，由 Host Runtime 强制执行，包含房主。 |
| `room.allowSpectators` | `boolean` | | 是否允许观众。 |
| `sync.mode` | `'snapshot' \| 'patch'` | | 同步模式，默认 `'snapshot'`。当前仅 `snapshot` 真正生效。 |
| `sync.snapshotInterval` | `number` | | 快照间隔（保留字段）。 |
| `permissions.network` | `boolean` | | 是否允许网络，建议 `false`。 |
| `permissions.storage` | `'none' \| 'session' \| 'local'` | | 存储权限，建议 `'session'`。 |
| `permissions.camera` | `boolean` | | 摄像头。 |
| `permissions.microphone` | `boolean` | | 麦克风。 |
| `permissions.clipboard` | `boolean` | | 剪贴板。 |
| `permissions.sensors` | `('accelerometer' \| 'gyroscope' \| 'magnetometer')[]` | | 房间使用的设备传感器；声明后宿主在分享区域显示权限模块。 |
| `actions` | `Record<string, { payload?: string }>` | | action 声明（描述用，非强制校验）。 |

## 校验规则

只校验最关键的项：

- `id`、`name`、`version`、`partiVersion` 必须是**非空字符串**。
- `protocolVersion` 必须是**数字**。
- `entry` 必须同时包含字符串类型的 `ui` 与 `worker`。
- `permissions.sensors` 必须是无重复项的数组，且只能包含 `accelerometer`、`gyroscope`、`magnetometer`。
- `tags` 如存在，必须是由非空字符串组成的无重复数组。

其余字段不校验，但建议如实声明。

`room.maxPlayers` 的容量计算包含房主和断线宽限期内的保留席位。达到上限后，Runtime
会以 `ROOM_FULL` 拒绝新玩家；已有身份的宽限期重连不会占用新席位。

## Package 元信息与运行实例设置

manifest 描述可复用的 Room Package。每次联机运行的标题、是否公开、加入密码和大厅
租约属于**运行实例设置**，不应写入 `parti.room.json`。这样同一个 Package 可以同时由
多个房主创建不同标题、可见性和准入规则的在线房间。

## Package 文件与加载模式

- `blob`：UI 入口经 SDK 注入后创建 Blob URL。适合内联脚本和样式的小型房间；不提供包内相对资源语义。
- `filesystem`：完整 package 挂载到 `/_parti/packages/<hash>/`，HTML、模块、CSS、图片、音频和同包 `fetch()` 可使用普通相对路径。该模式要求浏览器支持 Service Worker。

ZIP、GitHub 导入和内置房间会收集 package 根目录中的全部文件。Worker 目前仍为单入口源码，不支持相对模块 import。

## 权限与沙箱

MVP 阶段建议尽量保守：

```json
"permissions": {
  "network": false,
  "storage": "session",
  "camera": false,
  "microphone": false,
  "clipboard": false,
  "sensors": []
}
```

声明传感器后，房主和成员都可以在房间的分享/更多区域主动申请权限。例如倾斜控制通常声明
`["accelerometer", "gyroscope"]`。权限申请必须由用户点击触发，并且生产页面必须使用 HTTPS。

Blob 与 filesystem UI iframe 统一使用 `sandbox="allow-scripts allow-same-origin"`。
`packageMode` 不改变权限模型；当前应仅运行可信 package，后续安全限制由独立机制负责。
沙箱并不会自动禁止网络；当前权限声明只作展示与未来策略使用，外部请求仍服从浏览器 CORS。

## 真实示例

### `counter`（多人计数器）

```json
{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "counter",
  "name": "多人计数器",
  "version": "0.1.0",
  "packageMode": "blob",
  "description": "一个简单的多人计数器，验证 action / snapshot / broadcast。",
  "author": { "name": "Parti" },
  "entry": { "ui": "index.html", "worker": "room.worker.js" },
  "room": { "minPlayers": 1, "maxPlayers": 8 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
```

### `guess-word`（猜词游戏）

```json
{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "guess-word",
  "name": "猜词游戏",
  "version": "0.1.0",
  "packageMode": "blob",
  "description": "所有人 ready 后开始，根据提示猜词，第一个猜中者获胜。",
  "author": { "name": "Parti" },
  "entry": { "ui": "index.html", "worker": "room.worker.js" },
  "room": { "minPlayers": 1, "maxPlayers": 8 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
```
