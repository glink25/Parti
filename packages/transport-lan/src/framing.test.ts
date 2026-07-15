import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportMessage } from '@parti/core';
import { FramedDataChannel, type DataChannelLike } from './framing';

class LoopbackChannel implements DataChannelLike {
  readyState: RTCDataChannelState = 'open';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  peer?: LoopbackChannel;
  sends: Array<string | ArrayBuffer | ArrayBufferView> = [];

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    this.sends.push(data);
    const delivered = typeof data === 'string'
      ? data
      : data instanceof ArrayBuffer
        ? data.slice(0)
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.peer?.onmessage?.({ data: delivered } as MessageEvent);
  }
  close(): void { this.readyState = 'closed'; this.onclose?.(new Event('close')); }
}

function pair(): [LoopbackChannel, LoopbackChannel] {
  const left = new LoopbackChannel();
  const right = new LoopbackChannel();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

describe('LAN data framing', () => {
  afterEach(() => vi.useRealTimers());
  it('reassembles large object messages from 16 KiB chunks', async () => {
    const [left, right] = pair();
    const sender = new FramedDataChannel(left);
    const receiver = new FramedDataChannel(right);
    const received = new Promise<TransportMessage>((resolve) => receiver.onMessage(resolve));

    sender.send({ data: { text: 'x'.repeat(40_000) }, meta: { reliable: true, ordered: true } });

    await expect(received).resolves.toEqual({
      data: { text: 'x'.repeat(40_000) },
      meta: { reliable: true, ordered: true },
    });
    expect(left.sends.length).toBe(4); // header + three payload chunks
  });

  it('preserves string and ArrayBuffer payload types', async () => {
    const [left, right] = pair();
    const sender = new FramedDataChannel(left);
    const receiver = new FramedDataChannel(right);
    const values: TransportMessage[] = [];
    receiver.onMessage((message) => values.push(message));

    sender.send({ data: 'hello' });
    sender.send({ data: new Uint8Array([1, 2, 3]).buffer });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(values[0]?.data).toBe('hello');
    expect([...new Uint8Array(values[1]?.data as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it('waits for buffered data to drain before sending', async () => {
    vi.useFakeTimers();
    const [left] = pair();
    left.bufferedAmount = 1024 * 1024 + 1;
    const sender = new FramedDataChannel(left);
    sender.send({ data: 'backpressure' });
    await Promise.resolve();
    expect(left.sends).toHaveLength(0);

    left.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(10);
    expect(left.sends).toHaveLength(2);
  });

  it('closes and releases an incomplete incoming frame after a timeout', async () => {
    vi.useFakeTimers();
    const [, right] = pair();
    const receiver = new FramedDataChannel(right);
    const closed: Array<string | undefined> = [];
    receiver.onClose((reason) => closed.push(reason));
    right.onmessage?.({
      data: 'parti-frame-v1:' + JSON.stringify({ id: 1, type: 'binary', totalBytes: 5 }),
    } as MessageEvent);
    right.onmessage?.({ data: new Uint8Array([1, 2]).buffer } as MessageEvent);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(closed).toEqual(['incomplete-frame']);
    expect(right.readyState).toBe('closed');
  });
});
