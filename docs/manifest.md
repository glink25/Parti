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
| `entry.ui` | `string` | ✅ | UI 入口文件名，如 `"index.html"`。 |
| `entry.worker` | `string` | ✅ | 逻辑入口文件名，如 `"room.worker.js"`。 |
| `entry.client` | `string` | | 可选的额外客户端脚本。 |
| `entry.style` | `string` | | 可选的样式表。 |
| `description` | `string` | | 房间描述。 |
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
| `actions` | `Record<string, { payload?: string }>` | | action 声明（描述用，非强制校验）。 |

## 校验规则

只校验最关键的项：

- `id`、`name`、`version`、`partiVersion` 必须是**非空字符串**。
- `protocolVersion` 必须是**数字**。
- `entry` 必须同时包含字符串类型的 `ui` 与 `worker`。

其余字段不校验，但建议如实声明。

`room.maxPlayers` 的容量计算包含房主和断线宽限期内的保留席位。达到上限后，Runtime
会以 `ROOM_FULL` 拒绝新玩家；已有身份的宽限期重连不会占用新席位。

## Package 元信息与运行实例设置

manifest 描述可复用的 Room Package。每次联机运行的标题、是否公开、加入密码和大厅
租约属于**运行实例设置**，不应写入 `parti.room.json`。这样同一个 Package 可以同时由
多个房主创建不同标题、可见性和准入规则的在线房间。

## ⚠️ 只有 entry 里声明的文件才会被加载

加载房间时，Runtime 只会去 fetch `entry.ui`、`entry.worker`、`entry.client`、
`entry.style` 这四个字段里列出的文件。如果你加了 `style.css` 却没写进
`entry.style`，它**不会被加载**。

## 权限与沙箱

MVP 阶段建议尽量保守：

```json
"permissions": {
  "network": false,
  "storage": "session",
  "camera": false,
  "microphone": false,
  "clipboard": false
}
```

UI iframe 默认以 `sandbox="allow-scripts"` 运行，本身已经限制了网络 / 存储 / 父页面访问；
权限声明是给平台展示与未来放权用的。

## 真实示例

### `counter`（多人计数器）

```json
{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "counter",
  "name": "多人计数器",
  "version": "0.1.0",
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
  "description": "所有人 ready 后开始，根据提示猜词，第一个猜中者获胜。",
  "author": { "name": "Parti" },
  "entry": { "ui": "index.html", "worker": "room.worker.js" },
  "room": { "minPlayers": 1, "maxPlayers": 8 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
```
