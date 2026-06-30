# 协议参考（进阶 / 可选）

> **大多数创作者不需要读这篇。** 你写房间只接触 [`defineRoom`](./worker-api.md) 和
> [`parti`](./client-api.md) 两套高层 API；下面的协议消息、序号、确认、快照都由 Runtime
> 自动代办。本篇供想了解底层、做调试或扩展 Runtime 的人查阅。

源码：`packages/core/src/protocol/messages.ts`。

## 消息信封（Envelope）

所有底层消息共用统一信封：

```ts
type RoomMessage<T = unknown> = {
  v: 1;
  id: string;        // 消息唯一 id
  roomId: string;
  from: string;      // 发送者 id
  to?: string;       // 接收者 id（可选）
  seq: number;       // 连接内递增序号
  ack?: number;      // 已确认序号
  channel: 'sys' | 'input' | 'state' | 'event' | 'rpc' | 'debug';
  type: string;      // 见下方消息类型
  ts: number;        // 发送时间
  payload: T;
};
```

## 消息类型

### 系统消息 `sys:*`

```txt
sys:hello            玩家加入时上报（版本、包 hash、身份、能力）
sys:welcome          房主回应加入（分配 playerId、玩家列表、stateVersion）
sys:join             房主广播：有玩家加入
sys:leave            房主广播：有玩家离开
sys:ready            玩家标记就绪
sys:ping / sys:pong  心跳
sys:error            协议错误（见错误码）
sys:kick             房主踢人
sys:host-closed      房主关闭
sys:resync-request   请求重新同步完整状态
sys:resume-ok        房主确认玩家重连成功
sys:package-request  请求房间代码包
sys:package-data     房主下发房间代码包
sys:capabilities     能力协商
```

### 准入握手

加入者在下载 Package 和正式加入两个阶段都携带同一个 opaque credential。Runtime 不解释
credential 的业务含义，只把它交给宿主页安装的 admission controller。

```ts
interface PackageRequestPayload {
  partiVersion: string;
  clientId?: string;
  credential?: string;
}

interface HelloPayload {
  partiVersion: string;
  protocolVersion: number;
  roomPackageHash: string;
  player: { name?: string; avatar?: string; clientId?: string };
  capabilities: Capabilities;
  admission?: { credential?: string };
}
```

顺序为：`sys:package-request` 准入 → `sys:package-data` → 校验 packageHash →
`sys:hello` 再次准入 → `sys:welcome`。任一阶段失败均返回 `sys:error`，且不会创建玩家。
宽限期内命中既有 `clientId` 的连接按重连处理，不重复要求凭据或新席位。

credential 在 Host、Client 和 DevTools 消息日志中固定显示为 `[REDACTED]`，不得写入
快照、错误详情或持久化玩家记录。

### 游戏消息 `game:*`

```txt
game:action      玩家提交意图（对应 parti.action / actions handler）
game:event       房主广播游戏事件（对应 ctx.broadcast / parti.onEvent）
game:rpc         保留，未实现
game:rpc-result  保留，未实现
```

### 状态消息 `state:*`

```txt
state:snapshot   完整状态快照 —— ✅ 当前同步机制
state:patch      增量状态变更 —— 类型已定义，MVP 未实现
state:hash       状态校验 hash —— 保留
state:resync     重新同步指令 —— 保留
```

## 错误码 `RoomErrorCode`

`sys:error` 的 `code` 取值：

| 码 | 含义 |
| --- | --- |
| `ROOM_FULL` | 房间已满 |
| `CREDENTIAL_REQUIRED` | 房间要求准入凭据，但请求未提供 |
| `INVALID_CREDENTIAL` | 准入凭据无效 |
| `VERSION_MISMATCH` | 协议版本或房间包 hash 不一致 |
| `INVALID_ACTION` | 未知 action 名 |
| `BAD_PAYLOAD` | 消息 payload 非法 |
| `FORBIDDEN` | 无权限（如观众提交了玩家 action） |
| `STATE_OUT_OF_SYNC` | 状态校验失败 |
| `HOST_CLOSED` | 房主断开 |
| `RUNTIME_ERROR` | `room.worker.js` 抛出未捕获异常 |
| `TRANSPORT_ERROR` | 网络 / 传输层错误 |

UI 侧可通过保留事件 `parti.onEvent('__error', ({ code, message }) => ...)` 感知错误。

## 当前实现状态（重要）

`GOAL.md` 描述了完整的长期设计，但 **MVP 只实现了其中一部分**。以下功能**尚未实现 /
仅为保留**，请勿当作可用能力写进房间：

- `state:patch` 增量同步（当前一律全量 `state:snapshot`）
- `game:rpc` / `game:rpc-result`
- 主机迁移（host migration）
- 云端托管 Room Worker
- Socket.IO / WebSocket 等 PeerJS 之外的 Transport

当前可用：**Local（本地预览）+ PeerJS（联机）两种 Transport，snapshot 同步，
内置重连与持久化恢复。**
