/**
 * 验证 guess-word 房间在 Runtime 上的通用性 (GOAL.md §22.2)：
 * ready → phase 流转 → 隐藏答案 → 胜负判断 → game:event。
 * 直接加载仓库中真实的 room.worker.js 文件。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HostRuntime,
  ClientRuntime,
  PARTI_VERSION,
  type SnapshotPayload,
} from '@parti/core';
import { LocalTransportAdapter } from '@parti/transport-local';
import { InProcessWorkerHost } from '@parti/worker-sdk';

const ROOM_SOURCE = readFileSync(
  fileURLToPath(
    new URL('../../../apps/web/public/rooms/guess-word/room.worker.js', import.meta.url),
  ),
  'utf8',
);

const ROOM_ID = 'guess-test';
const HASH = 'guess-hash';

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('guess-word 房间', () => {
  it('两人准备后进入 playing，猜中后 finished 并广播 game:finished', async () => {
    const adapter = new LocalTransportAdapter();
    const transport = await adapter.createHost({ roomId: ROOM_ID, hostId: 'host' });
    const host = new HostRuntime({
      roomId: ROOM_ID,
      partiVersion: PARTI_VERSION,
      packageHash: HASH,
      transport,
      worker: new InProcessWorkerHost(),
      roomSource: ROOM_SOURCE,
    });
    await host.start();

    async function join(name: string) {
      const t = await adapter.joinRoom({ roomId: ROOM_ID, hostConnectionInfo: ROOM_ID });
      const rt = new ClientRuntime({
        roomId: ROOM_ID,
        partiVersion: PARTI_VERSION,
        packageHash: HASH,
        transport: t,
        playerName: name,
      });
      const snaps: SnapshotPayload[] = [];
      const events: Array<{ event: string; payload: unknown }> = [];
      rt.stateChanged.on((s) => snaps.push(s));
      rt.event.on((e) => events.push(e));
      await rt.start();
      return { rt, snaps, events, state: () => rt.getState<any>() };
    }

    const a = await join('Alice');
    const b = await join('Bob');
    await flush();

    // 全员 ready（host 自身也是一名玩家）
    host.submitLocalAction('ready', {});
    a.rt.submitAction('ready', {});
    await flush();
    b.rt.submitAction('ready', {});
    await flush();

    expect(a.state().phase).toBe('playing');
    expect(a.state().hint).toBeTruthy();
    // 答案不应出现在广播的 state 中（隐藏状态）
    expect(JSON.stringify(a.state())).not.toContain('__answer');

    // 穷举候选答案，必有一个命中
    for (const guess of ['parti', 'runtime', 'worker']) {
      if (a.state().phase === 'finished') break;
      a.rt.submitAction('guess', { text: guess });
      await flush();
    }

    expect(a.state().phase).toBe('finished');
    expect(a.state().winner).toBe(a.rt.getPlayerId());
    const finished = a.events.find((e) => e.event === 'game:finished');
    expect(finished).toBeTruthy();
    // 双方都看到结束状态同步
    expect(b.state().phase).toBe('finished');
  });
});
