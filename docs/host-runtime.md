# Host Runtime 准入与房间状态

本文面向 Parti 平台层和 Transport 集成者。房间创作者不需要调用这些 API；准入发生在
用户 `room.worker.js` 之外。

## 职责边界

```txt
Web 宿主页：维护标题、密码、公开状态和大厅租约
HostRuntime：强制容量与准入，维护权威玩家状态
room.worker.js：只处理已获准加入的 RoomPlayer
大厅服务：保存可发现的在线条目，不参与准入
```

credential、密码和大厅令牌不会进入 manifest、Worker 初始化参数、RoomPlayer、状态快照
或游戏事件。

## Admission Controller

```ts
interface RoomAdmissionController {
  authorize(request: AdmissionRequest): AdmissionDecision;
}

interface AdmissionRequest {
  roomId: string;
  phase: 'package' | 'join';
  peerId: string;
  clientId?: string;
  credential?: string;
}

type AdmissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'CREDENTIAL_REQUIRED' | 'INVALID_CREDENTIAL';
      message: string;
    };
```

创建 Host 时传入控制器和容量：

```ts
const host = new HostRuntime({
  // 其余 Runtime 参数……
  maxPlayers: manifest.room?.maxPlayers,
  admissionController: {
    authorize({ credential }) {
      if (!credential) {
        return { allowed: false, code: 'CREDENTIAL_REQUIRED', message: '需要密码' };
      }
      return credential === currentPassword
        ? { allowed: true }
        : { allowed: false, code: 'INVALID_CREDENTIAL', message: '密码错误' };
    },
  },
});
```

控制器是同步接口，不应在 `authorize` 中请求远程服务。需要服务端授权时，先在平台层换取
短期 opaque ticket，再由控制器进行本地同步校验。

房主修改密码或切换准入方式时调用 `host.setAdmissionController(nextController)`。传入
`undefined` 表示取消额外凭据校验；Runtime 始终保留容量校验。

## 双阶段校验

`phase: 'package'` 在返回 Room Package 前执行，`phase: 'join'` 在创建 Player 前再次执行。
两次校验可防止未授权下载自定义 Package，并处理下载后房间满员或策略变化的情况。

对新玩家，Runtime 依次检查容量和 controller。被拒绝时返回 `sys:error`，不会触发
Worker `onJoin`。宽限期内的既有 `clientId` 直接走重连，复用原 playerId 和席位。

## 权威状态

```ts
interface RoomAdmissionStatus {
  activePlayers: number;
  reservedPlayers: number;
  maxPlayers: number | null;
  joinable: boolean;
}

host.getAdmissionStatus();
host.admissionStatusChanged.on((status) => publish(status));
```

- `activePlayers`：`connected` 或 `ready` 的人数，包含房主。
- `reservedPlayers`：再包含宽限期内的离线席位，用于容量判断。
- `joinable`：未设置上限，或 `reservedPlayers < maxPlayers`。

大厅发布器应读取此状态，不应在 Web 组件中重复实现容量规则。

## 日志安全

Runtime 处理原始消息，但向 `messageLog` 发出的副本会递归把名为 `credential` 的字段替换为
`[REDACTED]`。集成方新增日志或遥测时也必须保持相同规则。
