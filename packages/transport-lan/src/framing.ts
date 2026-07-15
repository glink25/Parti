import type { TransportMessage } from '@parti/core';

const HEADER_PREFIX = 'parti-frame-v1:';
const CHUNK_SIZE = 16 * 1024;
const MAX_BUFFERED_AMOUNT = 1024 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const INCOMING_FRAME_TIMEOUT_MS = 30_000;

export interface DataChannelLike {
  readyState: RTCDataChannelState;
  binaryType: BinaryType;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(): void;
}

interface FrameHeader {
  id: number;
  type: 'json' | 'text' | 'binary';
  totalBytes: number;
  meta?: TransportMessage['meta'];
}

interface IncomingFrame {
  header: FrameHeader;
  chunks: Uint8Array[];
  bytes: number;
}

function payloadBytes(message: TransportMessage): { type: FrameHeader['type']; bytes: Uint8Array } {
  if (typeof message.data === 'string') {
    return { type: 'text', bytes: new TextEncoder().encode(message.data) };
  }
  if (message.data instanceof ArrayBuffer) {
    return { type: 'binary', bytes: new Uint8Array(message.data) };
  }
  return { type: 'json', bytes: new TextEncoder().encode(JSON.stringify(message.data)) };
}

function validHeader(value: unknown): value is FrameHeader {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const header = value as Partial<FrameHeader>;
  return Number.isSafeInteger(header.id)
    && (header.type === 'json' || header.type === 'text' || header.type === 'binary')
    && Number.isSafeInteger(header.totalBytes)
    && header.totalBytes! >= 0
    && header.totalBytes! <= MAX_MESSAGE_BYTES;
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export class FramedDataChannel {
  private nextId = 1;
  private sending = false;
  private closed = false;
  private incoming: IncomingFrame | null = null;
  private incomingTimer?: ReturnType<typeof setTimeout>;
  private readonly queue: TransportMessage[] = [];
  private readonly messageHandlers = new Set<(message: TransportMessage) => void>();
  private readonly closeHandlers = new Set<(reason?: string) => void>();

  private readonly channel: DataChannelLike;

  constructor(channel: RTCDataChannel | DataChannelLike) {
    this.channel = channel as unknown as DataChannelLike;
    this.channel.binaryType = 'arraybuffer';
    this.channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;
    this.channel.onmessage = (event) => this.receive(event.data);
    this.channel.onclose = () => this.finish('closed');
    this.channel.onerror = () => this.finish('error');
  }

  send(message: TransportMessage): void {
    if (this.closed) return;
    this.queue.push(message);
    void this.drain();
  }

  onMessage(handler: (message: TransportMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler: (reason?: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    if (this.closed) return;
    this.channel.close();
    this.finish('closed');
  }

  private async drain(): Promise<void> {
    if (this.sending || this.closed) return;
    this.sending = true;
    try {
      while (!this.closed && this.queue.length > 0) {
        const message = this.queue.shift()!;
        const payload = payloadBytes(message);
        if (payload.bytes.byteLength > MAX_MESSAGE_BYTES) {
          this.finish('message-too-large');
          return;
        }
        const header: FrameHeader = {
          id: this.nextId++,
          type: payload.type,
          totalBytes: payload.bytes.byteLength,
          ...(message.meta ? { meta: message.meta } : {}),
        };
        await this.waitForCapacity();
        if (this.closed) return;
        this.channel.send(HEADER_PREFIX + JSON.stringify(header));
        for (let offset = 0; offset < payload.bytes.byteLength; offset += CHUNK_SIZE) {
          await this.waitForCapacity();
          if (this.closed) return;
          this.channel.send(payload.bytes.slice(offset, offset + CHUNK_SIZE));
        }
      }
    } finally {
      this.sending = false;
      if (!this.closed && this.queue.length > 0) void this.drain();
    }
  }

  private async waitForCapacity(): Promise<void> {
    while (!this.closed && this.channel.readyState === 'open' && this.channel.bufferedAmount >= MAX_BUFFERED_AMOUNT) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.channel.readyState !== 'open') this.finish('closed');
  }

  private receive(raw: unknown): void {
    if (typeof raw === 'string') {
      if (!raw.startsWith(HEADER_PREFIX) || this.incoming) {
        this.finish('invalid-frame');
        return;
      }
      try {
        const header = JSON.parse(raw.slice(HEADER_PREFIX.length)) as unknown;
        if (!validHeader(header)) throw new Error('invalid header');
        this.incoming = { header, chunks: [], bytes: 0 };
        this.incomingTimer = setTimeout(() => this.finish('incomplete-frame'), INCOMING_FRAME_TIMEOUT_MS);
        if (header.totalBytes === 0) this.completeIncoming();
      } catch {
        this.finish('invalid-frame');
      }
      return;
    }
    const bytes = asBytes(raw);
    if (!bytes || !this.incoming) {
      this.finish('invalid-frame');
      return;
    }
    this.incoming.chunks.push(bytes.slice());
    this.incoming.bytes += bytes.byteLength;
    if (this.incoming.bytes > this.incoming.header.totalBytes) {
      this.finish('invalid-frame');
    } else if (this.incoming.bytes === this.incoming.header.totalBytes) {
      this.completeIncoming();
    }
  }

  private completeIncoming(): void {
    const frame = this.incoming;
    this.incoming = null;
    if (this.incomingTimer) clearTimeout(this.incomingTimer);
    this.incomingTimer = undefined;
    if (!frame) return;
    const combined = new Uint8Array(frame.header.totalBytes);
    let offset = 0;
    for (const chunk of frame.chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let data: TransportMessage['data'];
    try {
      if (frame.header.type === 'binary') data = combined.buffer;
      else {
        const text = new TextDecoder().decode(combined);
        data = frame.header.type === 'text' ? text : JSON.parse(text) as object;
      }
    } catch {
      this.finish('invalid-payload');
      return;
    }
    const message: TransportMessage = { data, ...(frame.header.meta ? { meta: frame.header.meta } : {}) };
    for (const handler of [...this.messageHandlers]) handler(message);
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    this.incoming = null;
    if (this.incomingTimer) clearTimeout(this.incomingTimer);
    this.incomingTimer = undefined;
    if (this.channel.readyState !== 'closed') this.channel.close();
    for (const handler of [...this.closeHandlers]) handler(reason);
  }
}
