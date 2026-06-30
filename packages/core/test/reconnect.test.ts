/**
 * 房间重连机制验收测试 (GOAL.md §17 Phase 4)：
 *  - 玩家断线在宽限期内带同 clientId 重连 → 复用 playerId、数据保留、走 onReconnect。
 *  - 宽限期到期 → onLeave + 玩家移除。
 *  - 房主用持久化快照重启 → worker 水合、onRestore 触发、onCreate 不重跑。
 *  - MemorySessionStore 读写 / clientId 往返。
 */
import { describe, it, expect } from 'vitest';
import {
  HostRuntime,
  ClientRuntime,
  PARTI_VERSION,
  MemorySessionStore,
  type SessionStore,
  type SnapshotPayload,
  type WelcomePayload,
} from '@parti/core';
import { LocalTransportAdapter } from '@parti/transport-local';
import { InProcessWorkerHost } from '@parti/worker-sdk';

/** 记录生命周期 hook 与玩家分数的房间。 */
const ROOM = `
export default defineRoom({
  initialState() {
    return { created: 0, restored: 0, players: {} };
  },
  onCreate(ctx) { ctx.state.created += 1; },
  onRestore(ctx) { ctx.state.restored += 1; },
  onJoin(ctx, p) {
    const cur = ctx.state.players[p.id] || { joins: 0, score: 0, reconnects: 0, left: false };
    cur.joins += 1;
    ctx.state.players[p.id] = cur;
  },
  onReconnect(ctx, p) {
    const cur = ctx.state.players[p.id] || { joins: 0, score: 0, reconnects: 0, left: false };
    cur.reconnects += 1;
    ctx.state.players[p.id] = cur;
  },
  onLeave(ctx, p) {
    if (ctx.state.players[p.id]) ctx.state.players[p.id].left = true;
  },
  actions: {
    score(ctx, { player }) {
      ctx.state.players[player.id].score += 1;
    },
  },
});
`;

const PACKAGE_HASH = 'test-hash';
const ROOM_ID = 'room-reconnect';

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface RoomState {
  created: number;
  restored: number;
  players: Record<
    string,
    { joins: number; score: number; reconnects: number; left: boolean }
  >;
}

async function makeHost(opts: { store?: SessionStore; graceMs?: number } = {}) {
  const adapter = new LocalTransportAdapter();
  const transport = await adapter.createHost({ roomId: ROOM_ID, hostId: 'host-1' });
  const host = new HostRuntime({
    roomId: ROOM_ID,
    partiVersion: PARTI_VERSION,
    packageHash: PACKAGE_HASH,
    transport,
    worker: new InProcessWorkerHost(),
    roomSource: ROOM,
    hostName: 'Host',
    ...(opts.store ? { store: opts.store } : {}),
    ...(opts.graceMs !== undefined ? { graceMs: opts.graceMs } : {}),
  });
  await host.start();
  return { adapter, host };
}

interface ClientHarness {
  runtime: ClientRuntime;
  welcome?: WelcomePayload;
  snapshots: SnapshotPayload[];
}

async function joinPlayer(
  adapter: LocalTransportAdapter,
  name: string,
  clientId?: string,
): Promise<ClientHarness> {
  const transport = await adapter.joinRoom({
    roomId: ROOM_ID,
    hostConnectionInfo: ROOM_ID,
  });
  const runtime = new ClientRuntime({
    roomId: ROOM_ID,
    partiVersion: PARTI_VERSION,
    packageHash: PACKAGE_HASH,
    transport,
    playerName: name,
    ...(clientId ? { clientId } : {}),
  });
  const harness: ClientHarness = { runtime, snapshots: [] };
  runtime.welcome.on((w) => (harness.welcome = w));
  runtime.stateChanged.on((s) => harness.snapshots.push(s));
  await runtime.start();
  return harness;
}

describe('房间重连机制 (Phase 4)', () => {
  it('宽限期内带同 clientId 重连：复用 playerId、保留分数、走 onReconnect', async () => {
    const { adapter, host } = await makeHost();
    const p1 = await joinPlayer(adapter, 'Alice', 'client-alice');
    await flush();
    const playerId = p1.welcome!.playerId;

    p1.runtime.submitAction('score', {});
    await flush();
    expect(
      host.currentSnapshot().state &&
        (host.currentSnapshot().state as RoomState).players[playerId].score,
    ).toBe(1);

    // 断线（软离线，宽限期默认 30s 不触发清除）
    p1.runtime.leave();
    await flush();
    expect(host.listPlayers().find((p) => p.id === playerId)?.status).toBe('offline');

    // 带同 clientId 重连
    const p1b = await joinPlayer(adapter, 'Alice', 'client-alice');
    await flush();

    // playerId 不变
    expect(p1b.welcome!.playerId).toBe(playerId);
    // host 玩家数稳定（host + 1）
    expect(host.listPlayers()).toHaveLength(2);

    const state = host.currentSnapshot().state as RoomState;
    expect(state.players[playerId].score).toBe(1); // 分数保留
    expect(state.players[playerId].joins).toBe(1); // 未二次 onJoin
    expect(state.players[playerId].reconnects).toBe(1); // 走了 onReconnect
    expect(host.listPlayers().find((p) => p.id === playerId)?.status).toBe('connected');

    host.dispose();
  });

  it('宽限期到期未重连：触发 onLeave 并移除玩家', async () => {
    const { adapter, host } = await makeHost({ graceMs: 20 });
    const p1 = await joinPlayer(adapter, 'Bob', 'client-bob');
    await flush();
    const playerId = p1.welcome!.playerId;

    p1.runtime.leave();
    await flush();
    expect(host.listPlayers().find((p) => p.id === playerId)?.status).toBe('offline');

    // 等待宽限期到期
    await new Promise((r) => setTimeout(r, 60));
    await flush();

    expect(host.listPlayers().find((p) => p.id === playerId)).toBeUndefined();
    const state = host.currentSnapshot().state as RoomState;
    expect(state.players[playerId].left).toBe(true);

    host.dispose();
  });

  it('房主用持久化快照重启：水合恢复、onRestore 触发、onCreate 不重跑', async () => {
    const store = new MemorySessionStore();

    // 第一次会话
    const s1 = await makeHost({ store });
    const p1 = await joinPlayer(s1.adapter, 'Carol', 'client-carol');
    await flush();
    const playerId = p1.welcome!.playerId;
    p1.runtime.submitAction('score', {});
    p1.runtime.submitAction('score', {});
    await flush();
    expect((s1.host.currentSnapshot().state as RoomState).players[playerId].score).toBe(2);
    const persistedVersion = s1.host.currentSnapshot().version;

    // 校验已写入 store
    const saved = store.loadRoom(ROOM_ID);
    expect(saved).not.toBeNull();
    expect(saved!.players.find((p) => p.clientId === 'client-carol')?.playerId).toBe(
      playerId,
    );

    s1.host.dispose();
    await flush();

    // 第二次会话（同一 store，模拟房主刷新）
    const s2 = await makeHost({ store });
    await flush();

    const state = s2.host.currentSnapshot().state as RoomState;
    expect(state.created).toBe(1); // onCreate 未重跑
    expect(state.restored).toBe(1); // onRestore 触发一次
    expect(state.players[playerId].score).toBe(2); // 分数恢复
    // 版本不回退，便于客户端继续接受更新
    expect(s2.host.currentSnapshot().version).toBeGreaterThanOrEqual(persistedVersion);
    // 上次在场玩家被重新登记为离线，等待重连
    expect(s2.host.listPlayers().find((p) => p.id === playerId)?.status).toBe('offline');

    // 该玩家凭 clientId 重连回归
    const p1b = await joinPlayer(s2.adapter, 'Carol', 'client-carol');
    await flush();
    expect(p1b.welcome!.playerId).toBe(playerId);
    expect((s2.host.currentSnapshot().state as RoomState).players[playerId].score).toBe(2);

    s2.host.dispose();
  });

  it('MemorySessionStore：房间记录与 clientId 读写/清理', () => {
    const store = new MemorySessionStore();
    expect(store.loadRoom('r1')).toBeNull();
    expect(store.loadClientId('r1')).toBeNull();

    store.saveClientId('r1', 'c1');
    expect(store.loadClientId('r1')).toBe('c1');

    const rec = {
      roomId: 'r1',
      hostPeerId: 'peer-1',
      hostPlayerId: 'host-1',
      snapshot: { version: 3, state: { x: 1 }, stateHash: 'h' },
      players: [{ clientId: 'c1', playerId: 'p1', name: 'A', role: 'player' as const }],
      updatedAt: Date.now(),
    };
    store.saveRoom(rec);
    expect(store.loadRoom('r1')?.snapshot.version).toBe(3);

    store.clearRoom('r1');
    expect(store.loadRoom('r1')).toBeNull();
  });
});
