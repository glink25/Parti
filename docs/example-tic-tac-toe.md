# 示例：从零写一个井字棋

本篇带你写一个完整、可运行的双人井字棋（Tic-Tac-Toe）。它比计数器更完整地用到了
Parti 的核心能力：

- **座位分配**：前两位玩家分别执 `X` / `O`（`onJoin`）
- **回合制**：只有轮到的一方能落子（action 里校验）
- **带 payload 的 action**：落子坐标 `{ cell }`
- **胜负 / 平局判定**：连成一线或棋盘填满
- **一次性事件**：`game:start` / `game:over` / `game:reset`（`broadcast`）
- **私密消息**：开局时只告诉每个玩家自己执什么子（`send`）
- **重开**：`restart` action

> 本篇代码已通过真实 Runtime 跑通验证（座位分配、非法落子拒绝、连线获胜、重开）。
> 把三个文件放进 `apps/web/public/rooms/tic-tac-toe/` 即可在 `pnpm dev` 里游玩。

先复习一下心智模型（详见 [快速开始](./getting-started.md)）：

```txt
点格子 → parti.action('mark', { cell }) → 房主 worker 校验并改 state → 自动广播 → onState 重渲染
```

---

## 1. `parti.room.json`

```json
{
  "partiVersion": "0.1.0",
  "protocolVersion": 1,
  "id": "tic-tac-toe",
  "name": "井字棋",
  "version": "0.1.0",
  "packageMode": "blob",
  "description": "经典双人井字棋：前两位玩家执 X / O，轮流落子，连成一线获胜。",
  "author": { "name": "Parti" },
  "entry": {
    "ui": "index.html",
    "worker": "room.worker.js"
  },
  "room": { "minPlayers": 2, "maxPlayers": 2 },
  "sync": { "mode": "snapshot" },
  "permissions": { "network": false, "storage": "session" }
}
```

字段含义见 [manifest.md](./manifest.md)。注意 `entry` 必须如实列出 `index.html`
和 `room.worker.js`，否则不会被加载。

---

## 2. `room.worker.js`（房间逻辑）

完整文件如下，下面分段讲解。

```js
import { defineRoom } from '@parti/worker-sdk';

// 八条获胜连线（行、列、对角）。常量放模块顶层即可，不进入 state。
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function findWinner(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a], line: [a, b, c] };
    }
  }
  return null;
}

export default defineRoom({
  meta: { name: '井字棋', minPlayers: 2, maxPlayers: 2 },

  initialState() {
    return {
      phase: 'waiting',            // waiting | playing | finished
      board: Array(9).fill(null),  // 每格 null | 'X' | 'O'
      players: {},                 // id -> { name, mark: 'X'|'O'|null }
      seats: { X: null, O: null }, // 座位 -> playerId
      turn: 'X',
      winner: null,                // null | 'X' | 'O' | 'draw'
      winLine: null,               // null | [a,b,c]
    };
  },

  onJoin(ctx, player) {
    let mark = null;
    if (!ctx.state.seats.X) {
      ctx.state.seats.X = player.id;
      mark = 'X';
    } else if (!ctx.state.seats.O) {
      ctx.state.seats.O = player.id;
      mark = 'O';
    }
    ctx.state.players[player.id] = { name: player.name, mark };

    // 只告诉该玩家自己执什么子（演示 send 的私密下发）
    ctx.send(player.id, 'seat:assigned', { mark });

    // 两个座位都坐满即开局
    if (ctx.state.seats.X && ctx.state.seats.O && ctx.state.phase === 'waiting') {
      ctx.state.phase = 'playing';
      ctx.state.turn = 'X';
      ctx.broadcast('game:start', {});
    }
  },

  onLeave(ctx, player) {
    const p = ctx.state.players[player.id];
    if (p && p.mark && ctx.state.seats[p.mark] === player.id) {
      ctx.state.seats[p.mark] = null;
    }
    delete ctx.state.players[player.id];
    if (ctx.state.phase === 'playing') {
      ctx.state.phase = 'waiting'; // 对手离开，回到等待
    }
  },

  actions: {
    // payload: { cell: 0..8 }
    mark(ctx, { player, payload }) {
      if (ctx.state.phase !== 'playing') return;
      const me = ctx.state.players[player.id];
      if (!me || !me.mark) return;            // 观众不能落子
      if (me.mark !== ctx.state.turn) return; // 不是你的回合

      const cell = Number(payload && payload.cell);
      if (!Number.isInteger(cell) || cell < 0 || cell > 8) return;
      if (ctx.state.board[cell] !== null) return; // 该格已被占

      ctx.state.board[cell] = me.mark;

      const win = findWinner(ctx.state.board);
      if (win) {
        ctx.state.phase = 'finished';
        ctx.state.winner = win.mark;
        ctx.state.winLine = win.line;
        ctx.broadcast('game:over', { winner: win.mark, line: win.line });
        return;
      }

      if (ctx.state.board.every((c) => c !== null)) {
        ctx.state.phase = 'finished';
        ctx.state.winner = 'draw';
        ctx.broadcast('game:over', { winner: 'draw' });
        return;
      }

      ctx.state.turn = ctx.state.turn === 'X' ? 'O' : 'X';
    },

    restart(ctx) {
      ctx.state.board = Array(9).fill(null);
      ctx.state.turn = 'X';
      ctx.state.winner = null;
      ctx.state.winLine = null;
      ctx.state.phase =
        ctx.state.seats.X && ctx.state.seats.O ? 'playing' : 'waiting';
      ctx.broadcast('game:reset', {});
    },
  },
});
```

### 讲解

- **`LINES` / `findWinner` 放在模块顶层**：它们是纯函数和常量，与 `defineRoom`
  并列写在同一个文件里即可。记住：房间 worker 只能 `import { defineRoom }`，
  不能 import 别的模块或第三方包（见 [worker-api §6](./worker-api.md#6-陷阱与约束务必阅读)）。
- **`initialState`** 定义了全部权威状态。`board` 用长度 9 的数组表示 3×3 棋盘。
- **`onJoin` 分配座位**：第一个加入的拿 `X`，第二个拿 `O`，之后的人 `mark` 为 `null`
  （等同观众，不能落子）。**注意房主自己也会触发 `onJoin`**，通常就是第一个、执 `X`。
- **`ctx.send(player.id, 'seat:assigned', { mark })`**：开局时单独告诉每位玩家自己执什么子。
  这里其实也能从 `state.players[myId].mark` 读到，用 `send` 只是演示私密下发的用法——
  在狼人杀这类游戏里就用它发只给一个人看的身份。
- **`mark` action 的校验**是关键：依次检查阶段、是不是玩家、是否轮到他、坐标是否合法、
  格子是否空。**任何一项不满足就 `return`**——什么都不改，于是什么都不广播，非法操作
  被悄悄忽略。永远不要相信客户端传来的 `payload`。
- **落子后**先判胜（`findWinner`），再判平局（棋盘填满），都不是则**切换回合**。
  胜负产生时广播 `game:over`，UI 可据此弹出结果。
- **`restart`** 重置棋盘但保留座位，双方还在就直接重新开局。

---

## 3. `index.html`（房间 UI）

```html
<div style="font-family: system-ui, sans-serif; padding: 16px; color: #111;">
  <h1 style="margin: 0 0 4px; font-size: 20px;">井字棋</h1>
  <p style="margin: 0 0 10px; color: #666; font-size: 13px;">
    你执 <b id="mark">…</b> · <span id="status"></span>
  </p>

  <div id="board"
       style="display:grid; grid-template-columns:repeat(3,64px); gap:4px;">
  </div>

  <button id="restart" style="margin-top:12px; display:none;">再来一局</button>

  <script>
    const boardEl = document.getElementById('board');
    const markEl = document.getElementById('mark');
    const statusEl = document.getElementById('status');
    const restartEl = document.getElementById('restart');

    // 创建 9 个格子按钮
    const cells = [];
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('button');
      b.style.cssText =
        'width:64px;height:64px;font-size:28px;font-weight:700;cursor:pointer;';
      b.onclick = () => parti.action('mark', { cell: i });
      cells.push(b);
      boardEl.appendChild(b);
    }

    let myMark = null;

    // 私密事件：开局时 Runtime 通过 send 告诉我执什么子
    parti.onEvent('seat:assigned', (p) => {
      myMark = p.mark;
      markEl.textContent = myMark || '观众';
    });

    // 一次性结果事件（可做提示音 / 动画，这里仅打印）
    parti.onEvent('game:over', (p) => {
      parti.log('game over', p.winner);
    });

    // 状态驱动：每次 state 变化整体重渲染
    parti.onState((state) => {
      // 棋盘
      state.board.forEach((v, i) => {
        cells[i].textContent = v || '';
        const occupied = v !== null || state.phase !== 'playing';
        cells[i].disabled = occupied;
        const win = state.winLine && state.winLine.includes(i);
        cells[i].style.background = win ? '#d8f5e0' : '';
      });

      // 兜底：万一错过了 seat:assigned 事件，从 state 里补读自己的 mark
      if (!myMark && state.players[parti.playerId]) {
        myMark = state.players[parti.playerId].mark;
        markEl.textContent = myMark || '观众';
      }

      // 状态行
      if (state.phase === 'waiting') {
        statusEl.textContent = '等待对手加入…';
      } else if (state.phase === 'playing') {
        statusEl.textContent =
          state.turn === myMark ? '轮到你了' : '等待对方落子…';
      } else {
        statusEl.textContent =
          state.winner === 'draw'
            ? '平局'
            : (state.winner === myMark ? '🎉 你赢了！' : '你输了');
      }

      restartEl.style.display = state.phase === 'finished' ? '' : 'none';
    });

    restartEl.onclick = () => parti.action('restart');

    // 入场即就绪
    parti.ready();
  </script>
</div>
```

### 讲解

- **UI 不写任何 import**，`parti` 是注入的全局对象（见 [client-api](./client-api.md)）。
- **`onState` 里整体重渲染**：根据 `state.board` 填字、根据 `state.phase` / `state.turn`
  更新状态行和按钮可用性、根据 `state.winLine` 高亮获胜连线。这是 Parti 房间 UI 的标准写法。
- **`parti.action('mark', { cell: i })`**：点击格子提交意图。注意它返回的 Promise
  不代表落子成功（可能没轮到你 / 格子被占），成败完全看随后的 `onState`——这正是
  状态驱动 UI 的好处：你不需要处理「失败」，界面永远按权威 state 显示。
- **`seat:assigned` 用 `onEvent` 接收**，配合 `onState` 里的兜底读取，确保任何时候都
  知道自己执 `X` 还是 `O`。
- **`parti.ready()`** 在末尾调用一次，告诉 Runtime 本玩家就绪。

---

## 4. 运行

```bash
pnpm dev   # http://localhost:5173
```

把上面三个文件放进 `apps/web/public/rooms/tic-tac-toe/`，用「本地预览（Host+2 玩家）」
即可两个虚拟玩家对弈；或用 PeerJS 模式生成邀请链接真人联机。

---

## 5. 下一步可以试试

- **回合计时**：用 `ctx.setTimer('turn', 15000, () => { /* 超时判负或跳过 */ })`
  做 15 秒落子限时，落子后 `ctx.clearTimer('turn')` 重置。见
  [worker-api：setTimer](./worker-api.md#settimer--cleartimer)。
- **隐藏状态**：把不想让对手看到的信息放模块顶层变量而非 `state`
  （[worker-api §6.2](./worker-api.md#6-陷阱与约束务必阅读)）。
- **更多玩家 / 观众**：放宽座位逻辑，给 `mark === null` 的人做一个观战视图。
- **比分**：在 `players[id]` 上加 `score`，`restart` 时保留，累计胜场。

更多 API 细节随时查 [worker-api.md](./worker-api.md) 和 [client-api.md](./client-api.md)。
