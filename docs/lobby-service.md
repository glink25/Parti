# 在线大厅服务契约

大厅是一个浅层、可替换的在线目录。它不运行 Room Worker、不转发玩家消息、不验证房间
密码，也不保存历史房间。Web 应用通过 `VITE_LOBBY_SERVICE_URL` 配置服务根地址。

## 通用要求

- API 前缀为 `/v1`，请求与响应使用 UTF-8 JSON。
- 浏览器跨域调用时必须允许 Web 应用 Origin、`Content-Type` 和 `Authorization`。
- 生产环境必须使用 HTTPS。
- 租约有效期为 60 秒；Host 每 20 秒续租。查询不得返回已过期条目。
- `leaseToken` 使用不可预测的随机值，只允许持有者更新或删除对应条目。
- 服务不得接收、推导、记录或返回房间密码/credential。

## 数据模型

公开房间输入：

```ts
interface LobbyRoomInput {
  roomId: string;
  hostPeerId: string;
  title: string;
  packageName: string;
  playerCount: number;
  maxPlayers: number | null;
  joinable: boolean;
  credentialRequired: boolean;
}
```

列表条目在输入基础上增加：

```ts
interface LobbyRoom extends LobbyRoomInput {
  listingId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}
```

时间字段使用 Unix 毫秒时间戳。

## API

### `GET /v1/health`

```json
{ "ok": true, "version": 1 }
```

### `GET /v1/rooms`

返回全部未过期条目：

```json
{
  "rooms": [
    {
      "listingId": "listing_abc",
      "roomId": "counter",
      "hostPeerId": "parti-host-123",
      "title": "周五计数器",
      "packageName": "多人计数器",
      "playerCount": 2,
      "maxPlayers": 8,
      "joinable": true,
      "credentialRequired": true,
      "createdAt": 1730000000000,
      "updatedAt": 1730000010000,
      "expiresAt": 1730000070000
    }
  ]
}
```

### `POST /v1/rooms`

Body 为 `LobbyRoomInput`。成功返回：

```json
{
  "listingId": "listing_abc",
  "leaseToken": "unpredictable-secret",
  "expiresAt": 1730000060000
}
```

### `PATCH /v1/rooms/:listingId`

Header：`Authorization: Bearer <leaseToken>`。Body 为完整 `LobbyRoomInput`，服务更新
展示字段并把 `expiresAt` 延长 60 秒，响应与 POST 相同。条目已过期时返回 404；Web
客户端会重新 POST 注册。

### `DELETE /v1/rooms/:listingId`

Header 同 PATCH。成功返回 204。浏览器异常关闭可能无法发送 DELETE，因此 TTL 是最终清理
机制。

## 校验与错误

- `title` 必须为去除首尾空白后的非空字符串，最长 80 字符。
- `roomId`、`hostPeerId`、`packageName` 必须为非空字符串。
- 人数必须为非负整数；`maxPlayers` 为正整数或 `null`。
- 令牌缺失或错误返回 401，条目不存在/过期返回 404，字段错误返回 422。
- 可选速率限制返回 429，暂时故障返回 5xx。
- 错误响应使用 `{ "error": { "code": "...", "message": "..." } }`。

初次健康检查或 POST 失败时，Web 房间保持私密。已经公开的房间发生临时 PATCH 故障时会
显示同步异常并继续重试，租约到期后自然从列表消失。
