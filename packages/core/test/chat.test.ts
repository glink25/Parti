/**
 * 验证 chat 房间：加入系统消息、send action 同步、空消息拒绝。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HostRuntime,
  ClientRuntime,
  PARTI_VERSION,
} from '@parti/core';
import { LocalTransportAdapter } from '@parti/transport-local';
import { InProcessWorkerHost } from '@parti/worker-sdk';

const ROOM_SOURCE = readFileSync(
  fileURLToPath(
    new URL('../../../apps/web/public/rooms/chat/room.worker.js', import.meta.url),
  ),
  'utf8',
);

const ROOM_ID = 'chat-test';
const HASH = 'chat-hash';

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('chat 房间', () => {
  it('两人加入后可互发消息，空消息被拒绝', async () => {
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
      await rt.start();
      return { rt, state: () => rt.getState<any>() };
    }

    const a = await join('Alice');
    const b = await join('Bob');
    await flush();

    expect(Object.keys(a.state().players).length).toBeGreaterThanOrEqual(2);
    expect(a.state().messages.some((m: { type: string }) => m.type === 'system')).toBe(true);

    a.rt.submitAction('send', { text: '你好' });
    await flush();

    expect(a.state().messages.find((m: { type: string; text: string }) => m.type === 'chat' && m.text === '你好')).toBeTruthy();
    expect(b.state().messages.find((m: { type: string; text: string }) => m.type === 'chat' && m.text === '你好')).toBeTruthy();

    b.rt.submitAction('send', { text: '   ' });
    await flush();

    expect(b.state().messages.filter((m: { type: string }) => m.type === 'chat')).toHaveLength(1);
  });
});
