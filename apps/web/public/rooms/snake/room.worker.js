import { defineRoom } from '@parti/worker-sdk';

// ── 常量（放模块顶层，不进入 state）─────────────────────────────
const COLS = 24;
const ROWS = 24;
const INTERVAL = 180;       // 每 tick 毫秒数
const FOOD_COUNT = 5;       // 棋盘上同时维持的食物数
const START_LEN = 3;        // 出生 / 重生时蛇身长度
const RESPAWN_MS = 2000;    // 死亡后重生延迟

const COLORS = [
  '#22c55e', '#3b82f6', '#ef4444', '#eab308',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

const DIRS = {
  up:    { x: 0,  y: -1 },
  down:  { x: 0,  y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1,  y: 0 },
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// ── 纯函数 / 辅助 ──────────────────────────────────────────────

// 收集当前所有被占用的格子（蛇身 + 食物）的 "x,y" key
function occupiedSet(state) {
  const set = new Set();
  for (const id in state.snakes) {
    for (const seg of state.snakes[id].body) set.add(seg.x + ',' + seg.y);
  }
  for (const f of state.food) set.add(f.x + ',' + f.y);
  return set;
}

// 随机一个空格；找不到（棋盘极满）时返回 null
function randEmptyCell(ctx) {
  const occ = occupiedSet(ctx.state);
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(ctx.random() * COLS);
    const y = Math.floor(ctx.random() * ROWS);
    if (!occ.has(x + ',' + y)) return { x, y };
  }
  return null;
}

// 在随机空格放一条朝右的初始蛇身
function spawnBody(ctx) {
  const head = randEmptyCell(ctx) || { x: 2, y: 2 };
  const body = [];
  for (let i = 0; i < START_LEN; i++) {
    body.push({ x: Math.max(0, head.x - i), y: head.y });
  }
  return body;
}

function pickColor(state) {
  const used = new Set(Object.values(state.snakes).map((s) => s.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[0];
}

function reviveSnake(ctx, snake) {
  snake.body = spawnBody(ctx);
  snake.dir = 'right';
  snake.pending = 'right';
  snake.alive = true;
  snake.respawnAt = 0;
}

function ensureFood(ctx) {
  while (ctx.state.food.length < FOOD_COUNT) {
    const cell = randEmptyCell(ctx);
    if (!cell) break;
    ctx.state.food.push(cell);
  }
}

// ── tick 循环（自驱动）─────────────────────────────────────────
let looping = false;

function ensureLoop(ctx) {
  if (looping) return;
  looping = true;
  arm(ctx);
}

function arm(ctx) {
  ctx.setTimer('tick', INTERVAL, () => {
    // 没有玩家就停止循环，省得空转
    if (Object.keys(ctx.state.snakes).length === 0) {
      looping = false;
      return;
    }
    tickAll(ctx);
    arm(ctx); // 重新 arm，形成自驱动循环
  });
}

function tickAll(ctx) {
  const state = ctx.state;
  state.tick += 1;
  const now = ctx.now();

  // 复活到点的死蛇
  for (const id in state.snakes) {
    const s = state.snakes[id];
    if (!s.alive && s.respawnAt && now >= s.respawnAt) reviveSnake(ctx, s);
  }

  // 移动前先记录所有活蛇当前占用的格子（用于碰撞判定）
  const blocked = new Set();
  for (const id in state.snakes) {
    const s = state.snakes[id];
    if (!s.alive) continue;
    for (const seg of s.body) blocked.add(seg.x + ',' + seg.y);
  }

  for (const id in state.snakes) {
    const s = state.snakes[id];
    if (!s.alive) continue;

    s.dir = s.pending;
    const d = DIRS[s.dir];
    const head = { x: s.body[0].x + d.x, y: s.body[0].y + d.y };

    // 撞墙
    const outOfBounds =
      head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS;
    // 撞任意蛇身（自己尾巴这一 tick 会让位，但极简起见统一判碰撞）
    const hitBody = blocked.has(head.x + ',' + head.y);

    if (outOfBounds || hitBody) {
      s.alive = false;
      s.respawnAt = now + RESPAWN_MS;
      // 清掉它占用的格子，让别人能通行
      for (const seg of s.body) blocked.delete(seg.x + ',' + seg.y);
      continue;
    }

    // 前进
    s.body.unshift(head);
    blocked.add(head.x + ',' + head.y);

    const fi = state.food.findIndex((f) => f.x === head.x && f.y === head.y);
    if (fi >= 0) {
      state.food.splice(fi, 1); // 吃掉食物，不缩尾 -> 变长
      s.score += 1;
    } else {
      const tail = s.body.pop(); // 没吃到则缩尾
      if (tail) blocked.delete(tail.x + ',' + tail.y);
    }
  }

  ensureFood(ctx);
}

// ── 房间定义 ───────────────────────────────────────────────────
export default defineRoom({
  meta: { name: '多人贪吃蛇', minPlayers: 1, maxPlayers: 8 },

  initialState() {
    return { cols: COLS, rows: ROWS, snakes: {}, food: [], tick: 0 };
  },

  onJoin(ctx, player) {
    ctx.state.snakes[player.id] = {
      name: player.name,
      color: pickColor(ctx.state),
      body: spawnBody(ctx),
      dir: 'right',
      pending: 'right',
      alive: true,
      score: 0,
      respawnAt: 0,
    };
    ensureFood(ctx);
    ensureLoop(ctx);
  },

  onLeave(ctx, player) {
    delete ctx.state.snakes[player.id];
  },

  // 房主刷新恢复后，模块顶层 looping 被重置，需要重启循环
  onRestore(ctx) {
    looping = false;
    ensureFood(ctx);
    ensureLoop(ctx);
  },

  actions: {
    // payload: { dir: 'up'|'down'|'left'|'right' }
    turn(ctx, { player, payload }) {
      const s = ctx.state.snakes[player.id];
      if (!s || !s.alive) return;
      const dir = payload && payload.dir;
      if (!DIRS[dir]) return;
      if (dir === OPPOSITE[s.dir]) return; // 禁止 180° 反向
      s.pending = dir;
    },
  },
});
