/**
 * Phase 0 验收测试 (GOAL.md §17)：
 *  - 本地启动 1 个 Host + 2 个虚拟 Player。
 *  - Player 发送 game:action。
 *  - Worker 修改 state。
 *  - 所有 Player 收到 state:snapshot，版本与 hash 正确演进。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HostRuntime,
  ClientRuntime,
  PARTI_VERSION,
  type SnapshotPayload,
  type WelcomePayload,
} from '@parti/core';
import { LocalTransportAdapter } from '@parti/transport-local';
import { InProcessWorkerHost } from '@parti/worker-sdk';

const COUNTER_ROOM = `
export default defineRoom({
  initialState() {
    return { count: 0, clicks: {} };
  },
  onJoin(ctx, player) {
    ctx.state.clicks[player.id] = 0;
  },
  actions: {
    increment(ctx, { player }) {
      ctx.state.count += 1;
      ctx.state.clicks[player.id] = (ctx.state.clicks[player.id] || 0) + 1;
      ctx.broadcast('counter:incremented', {
        playerId: player.id,
        count: ctx.state.count,
      });
    },
  },
});
`;

const PACKAGE_HASH = 'test-hash';
const ROOM_ID = 'room-test';

/** 反复让出，冲洗 LocalTransport 的 queueMicrotask 队列。 */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface ClientHarness {
  runtime: ClientRuntime;
  snapshots: SnapshotPayload[];
  welcome?: WelcomePayload;
  events: Array<{ event: string; payload: unknown }>;
}

async function makeHost() {
  const adapter = new LocalTransportAdapter();
  const transport = await adapter.createHost({ roomId: ROOM_ID, hostId: 'host-1' });
  const host = new HostRuntime({
    roomId: ROOM_ID,
    partiVersion: PARTI_VERSION,
    packageHash: PACKAGE_HASH,
    transport,
    worker: new InProcessWorkerHost(),
    roomSource: COUNTER_ROOM,
    hostName: 'Host',
  });
  await host.start();
  return { adapter, host };
}

async function joinPlayer(
  adapter: LocalTransportAdapter,
  name: string,
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
  });
  const harness: ClientHarness = { runtime, snapshots: [], events: [] };
  runtime.stateChanged.on((s) => harness.snapshots.push(s));
  runtime.welcome.on((w) => (harness.welcome = w));
  runtime.event.on((e) => harness.events.push(e));
  await runtime.start();
  return harness;
}

describe('Parti Runtime — 本地多人 (Phase 0)', () => {
  let adapter: LocalTransportAdapter;
  let host: HostRuntime;

  beforeEach(async () => {
    ({ adapter, host } = await makeHost());
  });

  it('两名玩家加入后均收到 welcome 与初始 snapshot', async () => {
    const p1 = await joinPlayer(adapter, 'Alice');
    const p2 = await joinPlayer(adapter, 'Bob');
    await flush();

    expect(p1.welcome?.playerId).toBeTruthy();
    expect(p2.welcome?.playerId).toBeTruthy();
    expect(p1.runtime.getState<{ count: number }>()?.count).toBe(0);
    expect(p2.runtime.getState<{ count: number }>()?.count).toBe(0);

    // host(1) + 2 玩家 = 3 人
    expect(host.listPlayers()).toHaveLength(3);
  });

  it('玩家 action 修改 state，所有玩家收到同步 snapshot', async () => {
    const p1 = await joinPlayer(adapter, 'Alice');
    const p2 = await joinPlayer(adapter, 'Bob');
    await flush();

    const baseVersion = host.currentSnapshot().version;

    p1.runtime.submitAction('increment', {});
    await flush();
    p2.runtime.submitAction('increment', {});
    await flush();

    const finalState = p2.runtime.getState<{ count: number; clicks: Record<string, number> }>();
    expect(finalState?.count).toBe(2);
    expect(p1.runtime.getState<{ count: number }>()?.count).toBe(2);

    // 版本递增（至少两次 commit）
    expect(host.currentSnapshot().version).toBeGreaterThan(baseVersion);

    // 两个玩家各贡献一次点击
    const clicks = finalState?.clicks ?? {};
    expect(Object.values(clicks).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('broadcast 的 game:event 到达所有玩家', async () => {
    const p1 = await joinPlayer(adapter, 'Alice');
    const p2 = await joinPlayer(adapter, 'Bob');
    await flush();

    p1.runtime.submitAction('increment', {});
    await flush();

    const got = (h: ClientHarness) =>
      h.events.filter((e) => e.event === 'counter:incremented');
    expect(got(p1).length).toBe(1);
    expect(got(p2).length).toBe(1);
    expect((got(p1)[0].payload as { count: number }).count).toBe(1);
  });

  it('snapshot hash 随状态变化而变化', async () => {
    const p1 = await joinPlayer(adapter, 'Alice');
    await flush();
    const h0 = host.currentSnapshot().stateHash;
    p1.runtime.submitAction('increment', {});
    await flush();
    const h1 = host.currentSnapshot().stateHash;
    expect(h1).not.toBe(h0);
  });

  it('协议版本不匹配时拒绝加入并回 sys:error', async () => {
    const transport = await adapter.joinRoom({
      roomId: ROOM_ID,
      hostConnectionInfo: ROOM_ID,
    });
    const runtime = new ClientRuntime({
      roomId: ROOM_ID,
      partiVersion: PARTI_VERSION,
      packageHash: 'WRONG_HASH',
      transport,
    });
    const errors: string[] = [];
    runtime.errors.on((e) => errors.push(e.code));
    await runtime.start();
    await flush();
    expect(errors).toContain('VERSION_MISMATCH');
  });
});
