/**
 * 房间包点对点分发 (GOAL §11.1)：加入者发 sys:package-request，
 * Host 回 sys:package-data 携带 manifest + 全部文件。早于 hello 即可处理。
 */
import { describe, it, expect } from 'vitest';
import {
  HostRuntime,
  PARTI_VERSION,
  SeqCounter,
  createMessage,
  type PackageDataPayload,
  type RoomMessage,
} from '@parti/core';
import { LocalTransportAdapter } from '@parti/transport-local';
import { InProcessWorkerHost } from '@parti/worker-sdk';

const ROOM_SOURCE = `
export default defineRoom({
  initialState() { return { count: 0 }; },
});
`;
const ROOM_ID = 'pkg-room';
const FILES = {
  'index.html': '<button id="x">hi</button>',
  'room.worker.js': ROOM_SOURCE,
};
const MANIFEST = { id: ROOM_ID, name: 'Pkg Room' };

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('Room Package 点对点分发', () => {
  it('Host 响应 sys:package-request，回带 manifest 与文件', async () => {
    const adapter = new LocalTransportAdapter();
    const transport = await adapter.createHost({ roomId: ROOM_ID, hostId: 'host-1' });
    const host = new HostRuntime({
      roomId: ROOM_ID,
      partiVersion: PARTI_VERSION,
      packageHash: 'h',
      transport,
      worker: new InProcessWorkerHost(),
      roomSource: ROOM_SOURCE,
      manifest: MANIFEST,
      packageFiles: FILES,
    });
    await host.start();

    const client = await adapter.joinRoom({
      roomId: ROOM_ID,
      hostConnectionInfo: ROOM_ID,
    });
    const received: PackageDataPayload[] = [];
    client.onMessage((tm) => {
      const m = tm.data as RoomMessage;
      if (m.type === 'sys:package-data') {
        received.push(m.payload as PackageDataPayload);
      }
    });

    const seq = new SeqCounter();
    const request = createMessage({
      roomId: ROOM_ID,
      from: client.selfId,
      to: client.hostId,
      seq: seq.next(),
      channel: 'sys',
      type: 'sys:package-request',
      payload: {},
    });
    client.send({ data: request, meta: { reliable: true, ordered: true } });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0].manifest).toEqual(MANIFEST);
    expect(received[0].files).toEqual(FILES);
  });

  it('未提供 packageFiles 时忽略请求（不回 package-data）', async () => {
    const adapter = new LocalTransportAdapter();
    const transport = await adapter.createHost({ roomId: ROOM_ID, hostId: 'host-2' });
    const host = new HostRuntime({
      roomId: ROOM_ID,
      partiVersion: PARTI_VERSION,
      packageHash: 'h',
      transport,
      worker: new InProcessWorkerHost(),
      roomSource: ROOM_SOURCE,
    });
    await host.start();

    const client = await adapter.joinRoom({
      roomId: ROOM_ID,
      hostConnectionInfo: ROOM_ID,
    });
    let got = 0;
    client.onMessage((tm) => {
      if ((tm.data as RoomMessage).type === 'sys:package-data') got += 1;
    });

    const seq = new SeqCounter();
    client.send({
      data: createMessage({
        roomId: ROOM_ID,
        from: client.selfId,
        to: client.hostId,
        seq: seq.next(),
        channel: 'sys',
        type: 'sys:package-request',
        payload: {},
      }),
      meta: { reliable: true, ordered: true },
    });
    await flush();

    expect(got).toBe(0);
  });
});
