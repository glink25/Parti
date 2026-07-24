import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommonProviderMessage } from './CommonTransportAdapter';
import {
  encodeSupabaseMessage,
  SupabaseMessageReassembler,
} from './SupabaseMessageFraming';

function message(data: CommonProviderMessage['message']['data'], target = 'joiner'): CommonProviderMessage {
  return {
    sender: 'host',
    target,
    message: { data },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Supabase message framing', () => {
  it('sends small messages without a framing envelope', () => {
    const original = message({ type: 'sys:welcome' });
    const frames = encodeSupabaseMessage(original);

    expect(frames).toHaveLength(1);
    expect(frames[0]!.payload).toBe(original);
    expect(frames[0]!.chunkTotal).toBeUndefined();
  });

  it('splits a large directed package message into payloads below 128 KiB and reassembles it', () => {
    const original = message({
      type: 'sys:package-data',
      payload: { files: { 'room.js': 'A'.repeat(400_000) } },
    });
    const frames = encodeSupabaseMessage(original, () => 'package-message');
    const reassembler = new SupabaseMessageReassembler(vi.fn());
    let result: CommonProviderMessage | undefined;

    for (const frame of frames) {
      expect(new TextEncoder().encode(JSON.stringify(frame.payload)).byteLength).toBeLessThan(128 * 1024);
      result = reassembler.accept(frame.payload) ?? result;
    }

    expect(frames.length).toBeGreaterThan(1);
    expect(result).toEqual(original);
    expect(result?.target).toBe('joiner');
  });

  it('reassembles out-of-order chunks and ignores identical duplicates', () => {
    const original = message('界'.repeat(100_000));
    const frames = encodeSupabaseMessage(original, () => 'out-of-order');
    const reassembler = new SupabaseMessageReassembler(vi.fn());
    const first = frames[0]!;

    expect(reassembler.accept(first.payload)).toBeUndefined();
    expect(reassembler.accept(first.payload)).toBeUndefined();

    let result: CommonProviderMessage | undefined;
    for (const frame of frames.slice(1).reverse()) result = reassembler.accept(frame.payload) ?? result;
    expect(result).toEqual(original);
  });

  it('rejects conflicting duplicate chunks', () => {
    const frames = encodeSupabaseMessage(message('x'.repeat(300_000)), () => 'duplicate');
    const reassembler = new SupabaseMessageReassembler(vi.fn());
    const first = structuredClone(frames[0]!.payload) as unknown as Record<string, unknown>;

    expect(reassembler.accept(first)).toBeUndefined();
    first.data = `${String(first.data).slice(0, -1)}A`;
    expect(() => reassembler.accept(first)).toThrow('conflicting duplicate');
  });

  it('expires incomplete messages and reports the missing chunks', () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const frames = encodeSupabaseMessage(message('x'.repeat(300_000)), () => 'missing');
    const reassembler = new SupabaseMessageReassembler(onError, 50);

    expect(reassembler.accept(frames[0]!.payload)).toBeUndefined();
    vi.advanceTimersByTime(50);

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('received=1/'));
  });

  it('keeps concurrent fragmented messages isolated', () => {
    const first = message('a'.repeat(250_000), 'a');
    const second = message('b'.repeat(250_000), 'b');
    const firstFrames = encodeSupabaseMessage(first, () => 'first');
    const secondFrames = encodeSupabaseMessage(second, () => 'second');
    const reassembler = new SupabaseMessageReassembler(vi.fn());
    const results: CommonProviderMessage[] = [];

    for (let index = 0; index < Math.max(firstFrames.length, secondFrames.length); index += 1) {
      for (const frame of [firstFrames[index], secondFrames[index]]) {
        if (!frame) continue;
        const result = reassembler.accept(frame.payload);
        if (result) results.push(result);
      }
    }

    expect(results).toEqual([first, second]);
  });

  it('rejects messages above the bounded reassembly size', () => {
    expect(() => encodeSupabaseMessage(message('x'.repeat(17 * 1024 * 1024)))).toThrow('maximum');
  });
});
