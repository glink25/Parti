# Parti 技术设计文档

## 1. 项目定位

Parti 是一个面向 Web 的多人互动房间 Runtime。

它的核心目标不是做一个固定玩法的游戏大厅，而是提供一套标准化的多人房间运行环境，让用户可以使用 HTML + JavaScript 快速创作、发布、分享和运行多人互动房间。

Parti 中的每个房间都可以由创作者动态定义：

* 房间 UI：由创作者提供 HTML / CSS / JS。
* 房间逻辑：由创作者提供 `room.worker.js`，语义上类似一个轻量 server。
* 房间协议：由 Parti Runtime 提供标准协议，创作者只需要声明 action、state、event。
* 通信能力：由 Parti Transport 层提供，可以从 PeerJS 切换到 Socket.IO、WebSocket、自建 Relay、云端托管等实现。
* 代码加载：房间代码不写死在 Parti 源码中，而是以 Room Package 的形式动态创建、存储、分发和运行。

一句话描述：

> Parti 是一个让用户用 HTML + JS 快速创作多人互动房间的标准化 Runtime。

---

## 2. 核心设计目标

### 2.1 创作者友好

创作者不应该直接理解 PeerJS、Socket.IO、WebRTC、重连、心跳、ack、snapshot、patch 等底层细节。

创作者应该只关心：

```js
room.action('guess', ({ player, payload, state }) => {
  if (payload.text === state.answer) {
    state.winner = player.id;
    room.broadcast('game:winner', { playerId: player.id });
  }
});
```

Parti Runtime 负责把这个 action 转换为标准协议消息、状态更新和网络广播。

---

### 2.2 通信能力可替换

Parti 第一阶段可以使用 PeerJS / WebRTC 作为核心通信方式，但协议和创作者 API 不能绑定 PeerJS。

未来应该可以切换到：

* PeerJS
* 原生 WebRTC
* Socket.IO
* WebSocket
* WebTransport
* 云端 Room Host
* 本地 LAN 连接
* 混合 Relay

创作者代码不应该因为通信层变化而改变。

也就是说，Parti 的核心抽象不应该是：

```ts
peer.send(message)
```

而应该是：

```ts
room.send(playerId, event, payload)
room.broadcast(event, payload)
room.action(name, handler)
```

底层 PeerJS / Socket.IO 只是不同的 Transport Adapter。

---

### 2.3 房间协议标准化

Parti 必须提供统一的 Room Protocol。

所有房间都使用相同的基础协议：

* 加入房间
* 离开房间
* ready
* action
* event
* state snapshot
* state patch
* resync
* error
* heartbeat
* capability negotiation

创作者可以扩展游戏 action 和 event，但不能绕过平台基础协议。

---

### 2.4 房间动态加载

Parti 不应该把所有房间写死在源码里。

每个房间应该是一个独立 Room Package：

```txt
room-package/
  parti.room.json
  index.html
  room.worker.js
  client.js
  style.css
  assets/
```

用户可以在 Web 端创建、编辑、保存和发布房间代码。

其他玩家加入房间时，Parti 会动态加载该房间的 UI 和 Worker 逻辑。

---

### 2.5 Host Authoritative 优先

Parti 的默认模型是 Host Authoritative：

```txt
Player action
  -> Host Runtime
  -> room.worker.js 验证 action
  -> 修改 authoritative state
  -> Runtime 生成 snapshot / patch / event
  -> 广播给所有玩家
```

玩家客户端只提交意图，不直接修改最终状态。

这样可以让房间逻辑更稳定，也方便后续做回放、断线恢复、主机迁移和云端托管。

---

## 3. 非目标

Parti 第一阶段不应该试图解决所有多人游戏问题。

MVP 阶段暂不追求：

* 高帧率实时动作游戏。
* 强防作弊。
* 完整云端沙箱托管。
* 完整插件市场。
* 大型房间高并发。
* 跨端原生能力。
* 完整的游戏引擎能力。
* 复杂物理同步。
* 帧同步 / 回滚网络架构。

Parti 第一阶段更适合支持：

* 你画我猜
* 狼人杀
* 谁是卧底
* 答题游戏
* 桌游原型
* 投票房间
* 多人互动剧本
* 抽卡 / 转盘 / 派对小游戏
* 轻量 RPG 房间
* 自定义多人工具

---

## 4. 核心概念

### 4.1 Parti Platform

Parti 主站和平台层。

负责：

* 用户登录
* 房间创建
* 房间列表
* 房间代码存储
* Room Package 管理
* 房间发布
* 房间版本管理
* 房间运行入口
* 举报、封禁、权限
* Transport 选择
* 基础安全策略

---

### 4.2 Room Package

一个房间的完整代码包。

包括：

* manifest
* UI HTML
* UI JS
* Worker JS
* CSS
* 静态资源
* 房间配置
* 协议声明
* 权限声明

建议命名为：

```txt
Parti Room Package
```

---

### 4.3 Room Manifest

房间的声明文件。

建议文件名：

```txt
parti.room.json
```

示例：

```json
{
  "partiVersion": "1.0.0",
  "id": "guess-word",
  "name": "猜词房间",
  "version": "0.1.0",
  "description": "一个简单的多人猜词游戏",
  "author": {
    "name": "room creator"
  },
  "entry": {
    "ui": "index.html",
    "worker": "room.worker.js",
    "client": "client.js",
    "style": "style.css"
  },
  "room": {
    "minPlayers": 2,
    "maxPlayers": 8,
    "allowSpectators": true
  },
  "sync": {
    "mode": "snapshot",
    "snapshotInterval": 1
  },
  "permissions": {
    "network": false,
    "storage": "session",
    "camera": false,
    "microphone": false
  },
  "actions": {
    "ready": {
      "payload": "object"
    },
    "guess": {
      "payload": "object"
    }
  }
}
```

---

### 4.4 Room UI

由创作者提供的 HTML 前端。

它运行在 Parti 提供的 sandbox iframe 中。

Room UI 不直接访问平台主页面，不直接访问真实 Transport，不直接访问其他玩家连接。

它只能通过 Parti Client SDK 和 Runtime 通信：

```js
parti.onState((state) => {
  render(state);
});

button.onclick = () => {
  parti.action('guess', {
    text: input.value
  });
};
```

---

### 4.5 Room Worker

由创作者提供的房间逻辑入口。

建议文件名：

```txt
room.worker.js
```

它的语义类似 `server.js`，但第一阶段实际运行在房主浏览器的 Web Worker 中。

Room Worker 不直接处理 PeerJS / Socket.IO，不直接处理网络连接，只处理 Parti Runtime 转发过来的标准事件。

示例：

```js
export default defineRoom({
  initialState() {
    return {
      phase: 'waiting',
      players: {},
      answer: 'parti',
      winner: null
    };
  },

  onJoin(ctx, player) {
    ctx.state.players[player.id] = {
      id: player.id,
      name: player.name,
      ready: false,
      score: 0
    };
  },

  actions: {
    ready(ctx, { player }) {
      ctx.state.players[player.id].ready = true;

      const allReady = Object.values(ctx.state.players).every(p => p.ready);

      if (allReady) {
        ctx.state.phase = 'playing';
        ctx.broadcast('game:start', {});
      }
    },

    guess(ctx, { player, payload }) {
      if (ctx.state.phase !== 'playing') {
        return;
      }

      if (payload.text === ctx.state.answer) {
        ctx.state.winner = player.id;
        ctx.state.players[player.id].score += 1;

        ctx.broadcast('game:winner', {
          playerId: player.id
        });
      }
    }
  }
});
```

---

### 4.6 Parti Runtime

Parti Runtime 是房间的标准运行时。

它负责：

* 加载 Room Package
* 创建 UI iframe
* 创建 Worker
* 注入 Client SDK
* 注入 Worker SDK
* 管理玩家列表
* 管理房间状态
* 管理协议消息
* 管理 Transport Adapter
* 管理状态同步
* 管理错误
* 管理重连
* 管理调试日志

Parti Runtime 是整个项目最核心的部分。

---

### 4.7 Transport Adapter

Transport Adapter 是通信能力的适配层。

Parti Runtime 不直接依赖 PeerJS 或 Socket.IO，而是依赖统一接口：

```ts
interface TransportAdapter {
  name: string;

  createHost(options: CreateHostOptions): Promise<HostTransportSession>;

  joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession>;
}
```

不同实现：

```txt
@parti/transport-peerjs
@parti/transport-socketio
@parti/transport-websocket
@parti/transport-local
@parti/transport-cloud
```

---

## 5. 总体架构

```txt
Parti Platform
  ├─ Room Registry
  ├─ Room Package Storage
  ├─ Lobby Service
  ├─ User / Auth
  ├─ Room Editor
  └─ Runtime Loader

Parti Runtime
  ├─ Room Package Loader
  ├─ UI Sandbox
  ├─ Worker Sandbox
  ├─ Protocol Engine
  ├─ State Sync Engine
  ├─ Transport Manager
  ├─ Player Manager
  └─ DevTools

Transport Adapters
  ├─ PeerJS Adapter
  ├─ Socket.IO Adapter
  ├─ WebSocket Adapter
  └─ Local Adapter

Room Package
  ├─ parti.room.json
  ├─ index.html
  ├─ client.js
  ├─ room.worker.js
  ├─ style.css
  └─ assets
```

---

## 6. 运行模型

### 6.1 第一阶段：房主浏览器托管

MVP 阶段采用 Host Browser Runtime。

也就是说：

* 房主创建房间。
* 房主浏览器加载 Room Worker。
* 房主浏览器成为 authoritative host。
* 其他玩家连接房主。
* 所有 action 都发送给房主。
* 房主 Worker 计算状态。
* 房主广播状态给玩家。

```txt
Player A ─┐
Player B ─┼─> Host Browser Runtime -> Room Worker
Player C ─┘
```

优点：

* 不需要复杂后端。
* 部署简单。
* 适合 PeerJS / WebRTC。
* 创作者可以快速实验。
* 成本低。

缺点：

* 房主关闭页面，房间结束。
* 房主设备性能影响房间。
* 房主具有天然权威。
* 防作弊能力有限。
* NAT / TURN 会影响连接成功率。

MVP 阶段可以接受这些限制，但必须在架构上为未来迁移留出口。

---

### 6.2 第二阶段：主机迁移

当房主离开时，可以从其他玩家中选出新的 host。

要求：

* 所有玩家都维护 event log。
* 所有玩家都能恢复最新 state。
* 房间代码包 hash 一致。
* Runtime 能重新建立 host topology。
* 旧 host 断线后触发 election。

主机迁移协议示例：

```ts
type HostMigrationMessage = {
  type: 'sys:host-migration';
  oldHostId: string;
  newHostId: string;
  roomPackageHash: string;
  stateVersion: number;
  snapshot: unknown;
};
```

---

### 6.3 第三阶段：云端托管

高级阶段可以把 Room Worker 托管到云端。

此时 `room.worker.js` 可以运行在：

* Node.js 沙箱
* Cloudflare Workers
* Deno
* Bun
* Web Worker compatible runtime
* isolate runtime

此时通信层可以切换到 Socket.IO / WebSocket / WebTransport。

创作者 API 不变：

```js
room.action('guess', handler);
```

只是 Runtime 从：

```txt
Host Browser Worker
```

切换为：

```txt
Cloud Room Worker
```

---

## 7. Transport 抽象设计

### 7.1 Transport 不负责理解游戏

Transport 只负责传输标准 RoomMessage。

Transport 不理解：

* 玩家是否能出牌
* 游戏是否结束
* state 如何合并
* action 是否有效

这些都由 Protocol Engine 和 Room Worker 处理。

---

### 7.2 Transport 接口

```ts
type PeerId = string;
type RoomId = string;

interface TransportMessage {
  data: ArrayBuffer | string | object;
  meta?: {
    reliable?: boolean;
    ordered?: boolean;
    channel?: string;
  };
}

interface HostTransportSession {
  selfId: PeerId;

  send(peerId: PeerId, message: TransportMessage): void;

  broadcast(message: TransportMessage, options?: {
    except?: PeerId[];
  }): void;

  onConnection(handler: (peer: TransportPeer) => void): void;

  onMessage(handler: (peerId: PeerId, message: TransportMessage) => void): void;

  onDisconnect(handler: (peerId: PeerId, reason?: string) => void): void;

  close(): void;
}

interface ClientTransportSession {
  selfId: PeerId;
  hostId: PeerId;

  send(message: TransportMessage): void;

  onMessage(handler: (message: TransportMessage) => void): void;

  onDisconnect(handler: (reason?: string) => void): void;

  close(): void;
}
```

---

### 7.3 PeerJS Adapter

PeerJS Adapter 的职责：

* 创建 host peer。
* 暴露 host peer id。
* 接受其他玩家连接。
* 为每个玩家维护 DataConnection。
* 将 DataConnection message 转换成 RoomMessage。
* 支持 broadcast。
* 支持断线事件。
* 支持基本重连。

PeerJS 适合 MVP，因为可以减少服务端负担。

但 PeerJS Adapter 不能暴露到创作者代码中。

错误示例：

```js
// 不推荐
room.peer.connections.forEach(...)
```

正确示例：

```js
// 推荐
room.broadcast('game:start', {});
```

---

### 7.4 Socket.IO Adapter

Socket.IO Adapter 的职责：

* 使用服务端房间概念管理玩家。
* 每个 Parti room 映射为一个 Socket.IO room。
* Host Runtime 可以在浏览器，也可以在服务端。
* Socket.IO 服务端负责玩家连接、广播、重连。

Socket.IO Adapter 适合：

* 需要更稳定连接的房间。
* 需要服务端权威的房间。
* 需要跨设备兼容性更高的场景。
* 需要后端记录和审核的场景。

Runtime 不应该感知这些差异。

---

### 7.5 Local Adapter

Local Adapter 用于开发和测试。

它不走真实网络，只在本地内存中模拟多人连接。

用途：

* 单元测试。
* DevTools。
* 房间预览。
* 自动化测试。
* 协议测试。

---

## 8. 标准 Room Protocol

### 8.1 Message Envelope

所有消息都必须使用统一 envelope。

```ts
type RoomMessage<T = unknown> = {
  v: 1;

  id: string;
  roomId: string;

  from: string;
  to?: string;

  seq: number;
  ack?: number;

  channel: 'sys' | 'input' | 'state' | 'event' | 'rpc' | 'debug';

  type: string;

  ts: number;

  payload: T;
};
```

字段说明：

| 字段        | 说明        |
| --------- | --------- |
| `v`       | 协议版本      |
| `id`      | 消息唯一 ID   |
| `roomId`  | 房间 ID     |
| `from`    | 发送者 ID    |
| `to`      | 接收者 ID，可选 |
| `seq`     | 连接内递增序号   |
| `ack`     | 已确认收到的序号  |
| `channel` | 消息通道      |
| `type`    | 消息类型      |
| `ts`      | 发送时间      |
| `payload` | 消息数据      |

---

### 8.2 系统消息

```ts
type SystemMessageType =
  | 'sys:hello'
  | 'sys:welcome'
  | 'sys:join'
  | 'sys:leave'
  | 'sys:ready'
  | 'sys:ping'
  | 'sys:pong'
  | 'sys:error'
  | 'sys:kick'
  | 'sys:host-closed'
  | 'sys:resync-request'
  | 'sys:capabilities';
```

---

### 8.3 游戏消息

```ts
type GameMessageType =
  | 'game:action'
  | 'game:event'
  | 'game:rpc'
  | 'game:rpc-result';
```

玩家客户端通常只能发送：

```txt
game:action
sys:ready
sys:pong
sys:resync-request
```

Host 可以发送：

```txt
game:event
state:snapshot
state:patch
sys:error
sys:kick
```

---

### 8.4 状态消息

```ts
type StateMessageType =
  | 'state:snapshot'
  | 'state:patch'
  | 'state:hash'
  | 'state:resync';
```

---

### 8.5 加入房间流程

```txt
1. Player 获取 roomId、roomPackageHash、hostConnectionInfo
2. Player Runtime 加载 Room Package
3. Player Transport 连接 Host
4. Player -> Host: sys:hello
5. Host 校验协议版本、房间版本、玩家信息
6. Host -> Player: sys:welcome
7. Host -> Player: state:snapshot
8. Player UI 初始化完成
9. Player -> Host: sys:ready
10. Host Worker 触发 onJoin / onReady
11. Host 广播 player joined / ready event
```

---

### 8.6 `sys:hello`

```ts
type HelloPayload = {
  partiVersion: string;
  protocolVersion: number;
  roomPackageHash: string;

  player: {
    name?: string;
    avatar?: string;
  };

  capabilities: {
    binary?: boolean;
    compression?: boolean;
    patch?: boolean;
  };
};
```

---

### 8.7 `sys:welcome`

```ts
type WelcomePayload = {
  playerId: string;

  role: 'host' | 'player' | 'spectator';

  room: {
    id: string;
    packageHash: string;
    createdAt: number;
  };

  players: Array<{
    id: string;
    name: string;
    role: 'host' | 'player' | 'spectator';
    status: 'connected' | 'ready' | 'offline';
  }>;

  stateVersion: number;
};
```

---

### 8.8 `game:action`

玩家提交意图。

```ts
type ActionPayload = {
  action: string;
  payload: unknown;
  clientActionId: string;
};
```

示例：

```json
{
  "action": "guess",
  "payload": {
    "text": "parti"
  },
  "clientActionId": "action_001"
}
```

---

### 8.9 `game:event`

Host 广播游戏事件。

```ts
type EventPayload = {
  event: string;
  payload: unknown;
};
```

示例：

```json
{
  "event": "game:winner",
  "payload": {
    "playerId": "player_1"
  }
}
```

---

### 8.10 `state:snapshot`

完整状态快照。

```ts
type SnapshotPayload = {
  version: number;
  state: unknown;
  stateHash: string;
};
```

---

### 8.11 `state:patch`

增量状态变更。

```ts
type StatePatchPayload = {
  baseVersion: number;
  nextVersion: number;
  patch: Array<{
    op: 'add' | 'remove' | 'replace';
    path: string;
    value?: unknown;
  }>;
  stateHash: string;
};
```

MVP 阶段可以先不实现 patch，只使用 snapshot。

---

### 8.12 `sys:error`

统一错误格式。

```ts
type RoomErrorPayload = {
  code:
    | 'ROOM_FULL'
    | 'VERSION_MISMATCH'
    | 'INVALID_ACTION'
    | 'BAD_PAYLOAD'
    | 'FORBIDDEN'
    | 'STATE_OUT_OF_SYNC'
    | 'HOST_CLOSED'
    | 'RUNTIME_ERROR'
    | 'TRANSPORT_ERROR';

  message: string;
  recoverable: boolean;
  detail?: unknown;
};
```

---

## 9. Room Worker API

### 9.1 设计原则

Room Worker API 应该隐藏协议细节。

创作者不应该手动处理：

* seq
* ack
* connection id
* transport type
* snapshot
* patch
* postMessage
* DataConnection
* Socket.IO socket

创作者只面对：

* state
* player
* action
* event
* broadcast
* send
* timer
* random
* log

---

### 9.2 `defineRoom`

```ts
type RoomDefinition<State = unknown> = {
  meta?: {
    name?: string;
    minPlayers?: number;
    maxPlayers?: number;
  };

  initialState(ctx: InitialContext): State;

  onCreate?(ctx: RoomContext<State>): void;

  onJoin?(ctx: RoomContext<State>, player: Player): void;

  onLeave?(ctx: RoomContext<State>, player: Player): void;

  onReady?(ctx: RoomContext<State>, player: Player): void;

  actions?: Record<string, ActionHandler<State>>;
};
```

---

### 9.3 `RoomContext`

```ts
type RoomContext<State> = {
  state: State;

  players: Player[];

  host: Player;

  now(): number;

  random(): number;

  broadcast(event: string, payload?: unknown): void;

  send(playerId: string, event: string, payload?: unknown): void;

  kick(playerId: string, reason?: string): void;

  log(...args: unknown[]): void;

  setTimer(name: string, ms: number, callback: () => void): void;

  clearTimer(name: string): void;
};
```

---

### 9.4 Action Handler

```ts
type ActionHandler<State> = (
  ctx: RoomContext<State>,
  event: {
    player: Player;
    payload: unknown;
    actionId: string;
  }
) => void | Promise<void>;
```

MVP 阶段建议先只支持同步 handler，后续再支持 async。

原因是 async 会带来状态并发、顺序一致性和错误恢复问题。

---

### 9.5 创作者示例

```js
export default defineRoom({
  initialState() {
    return {
      phase: 'waiting',
      players: {},
      question: null,
      winner: null
    };
  },

  onJoin(ctx, player) {
    ctx.state.players[player.id] = {
      name: player.name,
      ready: false,
      score: 0
    };

    ctx.broadcast('player:joined', {
      id: player.id,
      name: player.name
    });
  },

  actions: {
    ready(ctx, { player }) {
      ctx.state.players[player.id].ready = true;

      const allReady = Object.values(ctx.state.players).every(p => p.ready);

      if (allReady) {
        ctx.state.phase = 'playing';
        ctx.state.question = 'Parti 是什么？';

        ctx.broadcast('game:start', {
          question: ctx.state.question
        });
      }
    },

    answer(ctx, { player, payload }) {
      if (ctx.state.phase !== 'playing') {
        return;
      }

      if (payload.text.includes('多人互动房间')) {
        ctx.state.winner = player.id;
        ctx.state.phase = 'finished';

        ctx.broadcast('game:finished', {
          winner: player.id
        });
      }
    }
  }
});
```

---

## 10. Room UI API

### 10.1 设计原则

Room UI 是创作者的前端。

它应该通过 `parti` 全局对象和 Runtime 通信。

示例：

```js
parti.onState((state) => {
  render(state);
});

parti.onEvent('game:start', (payload) => {
  showQuestion(payload.question);
});

parti.action('answer', {
  text: input.value
});
```

---

### 10.2 Client SDK

```ts
interface PartiClient {
  playerId: string;

  getState<T = unknown>(): T | null;

  onState<T = unknown>(handler: (state: T) => void): () => void;

  onEvent<T = unknown>(
    event: string,
    handler: (payload: T) => void
  ): () => void;

  action<T = unknown>(
    action: string,
    payload?: T
  ): Promise<ActionResult>;

  ready(): void;

  leave(): void;

  log(...args: unknown[]): void;
}
```

---

### 10.3 UI 与 Runtime 通信

Room UI 不直接连接网络。

流程：

```txt
Room UI iframe
  -> Parti Client SDK
  -> parent.postMessage
  -> Parti Runtime
  -> Protocol Engine
  -> Transport Adapter
```

Host 收到 action 后：

```txt
Transport Adapter
  -> Protocol Engine
  -> Room Worker
  -> State Sync Engine
  -> Transport Adapter
  -> Player Runtime
  -> Room UI iframe
```

---

## 11. 动态房间加载

### 11.1 Room Package 存储

每个 Room Package 应该使用内容寻址。

```txt
packageHash = sha256(manifest + source files)
```

优点：

* 玩家可以校验收到的代码是否一致。
* 主机迁移时可以确认房间代码一致。
* 缓存方便。
* 版本管理方便。
* 可以避免房间运行中被静默替换。

---

### 11.2 加载流程

```txt
1. 用户打开房间链接
2. Parti Platform 获取 roomId
3. 查询当前 room 使用的 packageHash
4. 下载 Room Package
5. 校验 packageHash
6. 解析 parti.room.json
7. 创建 sandbox iframe
8. 注入 Parti Client SDK
9. 创建 Room Worker 或连接 Host
10. 加载 UI
11. 建立 Transport
12. 执行 sys:hello
13. 获取 snapshot
14. 渲染房间
```

---

### 11.3 房主创建房间流程

```txt
1. 用户进入 Parti Editor
2. 编写 index.html
3. 编写 room.worker.js
4. 编写 style.css / client.js
5. 点击预览
6. Local Adapter 模拟多人运行
7. 点击发布
8. 平台生成 Room Package
9. 计算 packageHash
10. 存储 package
11. 创建 room template
12. 用户从 template 创建 live room
```

---

### 11.4 玩家加入房间流程

```txt
1. 玩家打开邀请链接
2. 获取 live room 信息
3. 获取 room package
4. 加载 UI
5. 连接 Host
6. 发送 sys:hello
7. 接收 sys:welcome
8. 接收 state:snapshot
9. UI 进入房间
10. 玩家发送 ready
```

---

## 12. 沙箱与安全

### 12.1 UI 沙箱

Room UI 必须运行在 iframe sandbox 中。

建议默认：

```html
<iframe sandbox="allow-scripts"></iframe>
```

是否允许以下能力应该由 manifest 声明：

* forms
* modals
* pointer lock
* downloads
* same-origin
* popups
* camera
* microphone
* clipboard

默认不允许。

---

### 12.2 Worker 沙箱

Room Worker 应该运行在独立 Worker 中。

Worker 不应该直接访问：

* 平台 token
* 主站 DOM
* 玩家真实连接对象
* 平台数据库
* 未授权网络
* 未授权存储

Worker 只通过 Runtime Host API 操作房间。

---

### 12.3 权限声明

manifest 中声明权限：

```json
{
  "permissions": {
    "network": false,
    "storage": "session",
    "camera": false,
    "microphone": false,
    "clipboard": false
  }
}
```

第一阶段建议尽量保守：

```txt
network: false
storage: session
camera: false
microphone: false
clipboard: false
```

---

### 12.4 代码可信度

Parti 允许用户动态创建房间代码，所以必须默认认为房间代码不可信。

平台需要：

* 展示房间来源。
* 展示权限声明。
* 支持举报。
* 支持封禁。
* 支持静态扫描。
* 限制 iframe 能力。
* 限制 Worker 能力。
* 限制网络访问。
* 限制存储访问。
* 限制 CPU / 内存占用。
* 捕获运行时错误。

---

### 12.5 房主可信度

MVP 阶段房主浏览器是 authoritative host。

这意味着：

* 房主理论上可以修改本地代码。
* 房主可以作弊。
* 房主关闭页面会导致房间结束。
* 房主网络会影响所有人体验。

因此 Parti MVP 不应该宣传为强公平竞技平台。

更适合定位为：

```txt
多人互动创作平台
派对房间平台
轻量玩法分享平台
```

后续如果需要强公平，需要云端托管 Room Worker。

---

## 13. 状态同步策略

### 13.1 MVP：Snapshot 模式

第一版建议使用最简单的 snapshot 模式。

每次 state 改变后，Host 广播完整 state：

```ts
{
  type: 'state:snapshot',
  payload: {
    version: 12,
    state,
    stateHash
  }
}
```

优点：

* 实现简单。
* 创作者容易理解。
* 断线恢复容易。
* 调试容易。

缺点：

* 状态大时浪费带宽。
* 高频实时游戏不适合。

MVP 阶段可以接受。

---

### 13.2 第二阶段：Patch 模式

当 state 变大时，使用 patch。

```ts
{
  type: 'state:patch',
  payload: {
    baseVersion: 12,
    nextVersion: 13,
    patch: [
      {
        op: 'replace',
        path: '/players/player_1/score',
        value: 10
      }
    ],
    stateHash: '...'
  }
}
```

客户端应用 patch 后校验 hash。

如果 hash 不一致，请求 resync。

---

### 13.3 第三阶段：Event Sourcing

对于桌游、回合制、卡牌类房间，可以使用 event log。

```txt
action -> validated event -> reduce state
```

优点：

* 可回放。
* 可审计。
* 可主机迁移。
* 可做观战。
* 可做录像。
* 可做测试。

缺点：

* 创作者理解成本更高。
* Runtime 实现更复杂。

建议后续作为高级 sync mode。

---

### 13.4 实时模式

实时动作类游戏需要单独设计。

可能需要：

* tick
* input buffer
* interpolation
* prediction
* reconciliation
* rollback
* unreliable channel
* clock sync

不建议 MVP 阶段支持。

---

## 14. 协议版本与兼容

Parti 至少需要三类版本：

```txt
partiVersion       Parti Runtime 版本
protocolVersion    Room Protocol 版本
roomVersion        房间代码版本
```

manifest 示例：

```json
{
  "partiVersion": "1.0.0",
  "protocolVersion": 1,
  "version": "0.1.0"
}
```

加入房间时必须校验：

* Runtime 是否支持该 protocolVersion。
* 玩家加载的 packageHash 是否和房主一致。
* 房间是否允许当前客户端版本加入。

---

## 15. DevTools

Parti 应该内置房间调试面板。

### 15.1 必备功能

* 当前玩家列表
* 当前 state
* state version
* 消息日志
* action 日志
* event 日志
* error 日志
* Transport 状态
* ping / latency
* reconnect 次数
* packageHash
* Worker console
* iframe console
* 手动发送 action
* 导出 replay

---

### 15.2 Local Multiplayer Preview

编辑器里应该支持本地模拟多个玩家。

例如：

```txt
Preview as:
  - Host
  - Player 1
  - Player 2
  - Spectator
```

底层使用 Local Adapter，不走真实网络。

---

## 16. 文件结构建议

### 16.1 Monorepo

```txt
parti/
  apps/
    web/
      src/
        app/
        components/
        editor/
        runtime/
        lobby/

  packages/
    core/
      src/
        protocol/
        runtime/
        state/
        errors/

    client-sdk/
      src/
        index.ts

    worker-sdk/
      src/
        defineRoom.ts

    transport-peerjs/
      src/
        PeerJSTransportAdapter.ts

    transport-socketio/
      src/
        SocketIOTransportAdapter.ts

    transport-local/
      src/
        LocalTransportAdapter.ts

    room-packager/
      src/
        buildPackage.ts
        hashPackage.ts
        validateManifest.ts

    devtools/
      src/
        panel.tsx
```

---

### 16.2 `@parti/core`

负责：

* 协议类型
* message envelope
* player manager
* state sync
* runtime engine
* error code
* action validation
* hash
* logger

---

### 16.3 `@parti/client-sdk`

注入到 Room UI 中。

提供：

```ts
parti.action()
parti.onState()
parti.onEvent()
parti.ready()
parti.leave()
```

---

### 16.4 `@parti/worker-sdk`

提供给房间 Worker 使用。

```ts
defineRoom()
createState()
room.action()
room.broadcast()
room.send()
```

---

### 16.5 `@parti/transport-*`

不同通信层适配器。

所有 transport 都实现统一接口。

---

### 16.6 `@parti/room-packager`

负责：

* 解析 Room Package。
* 校验 manifest。
* 计算 hash。
* 打包资源。
* 生成可运行 bundle。
* 静态检查权限。

---

## 17. MVP 开发路线

### Phase 0：协议和 Runtime 骨架

目标：跑通本地单机模拟。

需要完成：

* `RoomMessage` 类型
* `defineRoom`
* `RoomRuntime`
* `LocalTransportAdapter`
* `ClientSDK`
* `WorkerSDK`
* `state:snapshot`
* `game:action`
* `game:event`
* 简单 DevTools log

验收标准：

* 可以在本地启动一个 Host 和两个虚拟 Player。
* Player 可以发送 action。
* Worker 可以修改 state。
* 所有 Player 收到 state snapshot。

---

### Phase 1：动态 Room Package

目标：房间代码不写死。

需要完成：

* `parti.room.json`
* package loader
* iframe sandbox
* Worker loader
* package hash
* 编辑器最小版本
* 本地预览

验收标准：

* 用户可以输入 HTML 和 Worker JS。
* 点击预览后生成一个 Room Package。
* Runtime 动态加载该 Package。
* 多个本地虚拟玩家可以交互。

---

### Phase 2：PeerJS Transport

目标：真实多人房间。

需要完成：

* PeerJS Host 创建
* PeerJS Player 加入
* 房间邀请链接
* sys:hello / sys:welcome
* player list
* disconnect
* heartbeat
* reconnect 基础能力

验收标准：

* 房主创建房间。
* 玩家通过链接加入。
* 玩家可以发送 action。
* 房主 Worker 处理 action。
* 所有人看到同步状态。

---

### Phase 3：房间发布与大厅

目标：形成产品闭环。

需要完成：

* 房间列表
* 房间详情页
* 创建房间
* 发布 Room Template
* 从 Template 创建 Live Room
* Room Package 存储
* 版本管理
* 基础举报
* 基础权限提示

验收标准：

* 用户可以创建一个房间模板。
* 其他人可以从模板开启房间。
* 玩家可以加入并游玩。
* 房间不需要写入主项目源码。

---

### Phase 4：更完善的同步和恢复

目标：提升稳定性。

需要完成：

* ack / seq
* 去重
* resync
* state hash
* patch mode
* event log 可选
* reconnect resume
* player offline status

验收标准：

* 玩家短暂断线后可以恢复。
* 状态不一致时可以自动请求 snapshot。
* Runtime 能展示消息序号和状态版本。

---

### Phase 5：Socket.IO / Cloud Host

目标：通信层切换能力验证。

需要完成：

* Socket.IO Adapter
* Server-hosted room session
* 可选择 transport
* 云端运行 Room Worker 的实验版本
* 权限与资源限制增强

验收标准：

* 同一个 Room Package 可以在 PeerJS Host 和 Socket.IO Host 下运行。
* 创作者代码不需要改。
* Runtime 只切换 adapter。

---

## 18. 最小 API 草案

### 18.1 Worker 侧

```js
import { defineRoom } from '@parti/worker';

export default defineRoom({
  initialState() {
    return {};
  },

  onJoin(ctx, player) {},

  onLeave(ctx, player) {},

  actions: {
    actionName(ctx, event) {}
  }
});
```

---

### 18.2 UI 侧

```html
<button id="ready">Ready</button>

<script>
  document.querySelector('#ready').onclick = () => {
    parti.action('ready');
  };

  parti.onState((state) => {
    console.log('state', state);
  });

  parti.onEvent('game:start', () => {
    console.log('game started');
  });
</script>
```

---

### 18.3 Runtime 内部

```ts
const runtime = new PartiRuntime({
  package,
  transport,
  role: 'host'
});

await runtime.start();
```

---

## 19. 房间代码示例

### 19.1 `parti.room.json`

```json
{
  "partiVersion": "1.0.0",
  "protocolVersion": 1,
  "id": "simple-counter",
  "name": "多人计数器",
  "version": "0.1.0",
  "entry": {
    "ui": "index.html",
    "worker": "room.worker.js"
  },
  "room": {
    "minPlayers": 1,
    "maxPlayers": 8
  },
  "sync": {
    "mode": "snapshot"
  },
  "permissions": {
    "network": false,
    "storage": "session"
  }
}
```

---

### 19.2 `index.html`

```html
<div>
  <h1>多人计数器</h1>
  <p id="count">0</p>
  <button id="inc">+1</button>
</div>

<script>
  const count = document.querySelector('#count');
  const button = document.querySelector('#inc');

  parti.onState((state) => {
    count.textContent = String(state.count);
  });

  button.onclick = () => {
    parti.action('increment');
  };

  parti.ready();
</script>
```

---

### 19.3 `room.worker.js`

```js
export default defineRoom({
  initialState() {
    return {
      count: 0,
      clicks: {}
    };
  },

  onJoin(ctx, player) {
    ctx.state.clicks[player.id] = 0;
  },

  actions: {
    increment(ctx, { player }) {
      ctx.state.count += 1;
      ctx.state.clicks[player.id] += 1;

      ctx.broadcast('counter:incremented', {
        playerId: player.id,
        count: ctx.state.count
      });
    }
  }
});
```

---

## 20. 关键技术原则

### 20.1 Runtime First

Parti 的核心不是 PeerJS，也不是 Socket.IO。

Parti 的核心是 Runtime。

通信层只是 Runtime 的一个插件。

---

### 20.2 Protocol Stable

一旦房间协议稳定，房间生态才有可能形成。

不要让每个房间自己发明消息格式。

---

### 20.3 User Code Is Untrusted

所有房间代码都应该默认不可信。

即使代码来自房主，也应该运行在沙箱中。

---

### 20.4 Host Is Replaceable

MVP 阶段 Host 是房主浏览器。

但架构上必须允许未来替换为：

* 其他玩家浏览器
* 平台服务器
* 云端 Worker
* Relay 服务

---

### 20.5 Actions Over Messages

创作者 API 应该围绕 action，而不是原始 message。

错误方向：

```js
onMessage(msg => {
  if (msg.type === 'move') {}
});
```

正确方向：

```js
actions: {
  move(ctx, event) {}
}
```

---

### 20.6 Snapshot First, Patch Later

第一版不要过度设计同步。

先使用完整 snapshot。

等房间复杂度提升后，再加入 patch 和 event log。

---

## 21. 主要风险

### 21.1 动态代码安全风险

用户可以上传任意 HTML / JS。

解决方向：

* iframe sandbox
* Worker sandbox
* 权限声明
* 静态扫描
* CSP
* 限制网络
* 限制存储
* 举报机制

---

### 21.2 Host 不稳定

房主关闭页面或网络差会导致房间体验下降。

解决方向：

* MVP 明确提示。
* 后续支持主机迁移。
* 再后续支持云端托管。

---

### 21.3 协议过早复杂化

如果第一版就做 patch、event sourcing、host migration，项目会很容易失控。

解决方向：

* 第一版只做 snapshot。
* 第一版只做 Host Authoritative。
* 第一版只做 PeerJS + Local Adapter。
* 等 API 稳定后再增强。

---

### 21.4 创作者 API 设计不稳定

如果创作者 API 频繁变动，房间生态会难以积累。

解决方向：

* 先内部 dogfood。
* 写 5 到 10 个官方示例房间。
* 根据示例反推 API。
* 再公开发布。

---

## 22. 推荐官方示例房间

为了验证 Parti Runtime，建议第一阶段至少实现这些示例：

### 22.1 多人计数器

验证：

* action
* state snapshot
* broadcast
* 多玩家加入

### 22.2 猜词游戏

验证：

* ready
* phase
* 玩家输入
* 胜负判断
* event

### 22.3 投票房间

验证：

* 匿名 / 非匿名状态
* 多玩家选择
* 结果统计
* 房主控制阶段

### 22.4 你画我猜简化版

验证：

* canvas 数据
* 大量输入
* spectator
* 回合制

### 22.5 狼人杀简化版

验证：

* 私密消息
* player role
* send to single player
* phase transition
* hidden state

这些示例可以帮助 Parti 反向验证 Runtime 是否足够通用。

---

## 23. 建议的开发优先级

最推荐的实现顺序：

```txt
1. @parti/core 协议类型
2. @parti/worker-sdk defineRoom
3. @parti/client-sdk parti.action / onState
4. LocalTransportAdapter
5. Runtime 本地模拟
6. iframe + Worker 动态加载
7. Room Package manifest
8. 多人计数器示例
9. PeerJS Adapter
10. 真实房间邀请链接
11. 编辑器
12. 房间发布
13. DevTools
14. Socket.IO Adapter
15. Patch / resync
16. 云端托管实验
```

---

## 24. 项目一句话路线图

Parti 的长期路线可以分成三步：

### 第一阶段：让房间跑起来

用户可以写 HTML + Worker JS，动态加载房间，并通过 PeerJS 进行多人交互。

### 第二阶段：让房间稳定起来

加入标准协议、断线恢复、状态校验、DevTools、房间版本管理和更好的沙箱。

### 第三阶段：让房间生态化

支持房间市场、Socket.IO / 云端托管、多种 Transport、官方示例、模板复用和创作者发布流程。

---

## 25. 最终定义

Parti 不是传统游戏大厅。

Parti 是一个多人互动房间 Runtime。

它的核心资产是：

* 标准 Room Protocol
* 可替换 Transport Adapter
* 动态 Room Package
* 沙箱化 UI + Worker
* 简洁创作者 API
* 可调试状态同步模型

只要这几件事设计稳定，PeerJS、Socket.IO、WebSocket 或云端托管都只是底层实现选择。

Parti 应该优先保证：

```txt
创作者写得爽
玩家进得快
协议跑得稳
通信换得掉
房间加载得动
未来托管得起
```

---

## 26. Web 在线大厅与 Host 准入边界

Web 在线大厅是可选的发现层，不改变 Parti 的 Host Authoritative 模型：

```txt
Lobby Service
  -> 仅保存公开房间目录、展示状态与短期租约

Web Host Page
  -> 管理运行实例标题、可见性、credential 策略与租约

HostRuntime
  -> 在 Package 下载与正式 Join 前执行容量和 admission 校验

room.worker.js
  -> 只接收已经获准加入的 RoomPlayer
```

大厅服务不托管 Worker、不转发游戏消息、不保存 credential。房间密码、邀请码或未来的
短期票据统一视为 opaque credential，由宿主页提供的 admission controller 校验。

准入属于 Runtime 基础协议，不属于用户房间协议。校验失败的连接不能创建 Player、不能
触发 `onJoin`，credential 不能进入 manifest、Worker context、state、event、持久化玩家
记录或调试日志。

大厅展示的在线人数、占位人数、容量和 `joinable` 必须来自 HostRuntime 的权威状态，
Web 层不重复实现容量规则。大厅不可用时，PeerJS 私密链接和房间运行保持可用。
