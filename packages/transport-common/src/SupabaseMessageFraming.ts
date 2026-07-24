import { v4 as uuidv4 } from 'uuid';
import type { CommonProviderMessage } from './CommonTransportAdapter';

const DIRECT_MESSAGE_MAX_BYTES = 120 * 1024;
const CHUNK_BYTES = 90 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = 192;
const REASSEMBLY_TIMEOUT_MS = 60_000;

interface ChunkMessage {
  __partiSupabaseChunk: 1;
  id: string;
  index: number;
  total: number;
  bytes: number;
  data: string;
}

interface PendingMessage {
  chunks: Array<Uint8Array | undefined>;
  received: number;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface EncodedSupabaseMessage {
  payload: CommonProviderMessage | ChunkMessage;
  encodedBytes: number;
  chunkIndex?: number;
  chunkTotal?: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const end = Math.min(offset + 0x8000, bytes.length);
    for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isChunkMessage(value: unknown): value is ChunkMessage {
  if (!value || typeof value !== 'object') return false;
  const chunk = value as Partial<ChunkMessage>;
  return chunk.__partiSupabaseChunk === 1
    && typeof chunk.id === 'string'
    && Number.isInteger(chunk.index)
    && Number.isInteger(chunk.total)
    && Number.isInteger(chunk.bytes)
    && typeof chunk.data === 'string';
}

export function encodeSupabaseMessage(
  message: CommonProviderMessage,
  createId: () => string = () => uuidv4(),
): EncodedSupabaseMessage[] {
  const encoded = new TextEncoder().encode(JSON.stringify(message));
  if (encoded.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(`message is ${encoded.byteLength} bytes; maximum is ${MAX_MESSAGE_BYTES}`);
  }
  if (encoded.byteLength <= DIRECT_MESSAGE_MAX_BYTES) {
    return [{ payload: message, encodedBytes: encoded.byteLength }];
  }

  const total = Math.ceil(encoded.byteLength / CHUNK_BYTES);
  if (total > MAX_CHUNKS) throw new Error(`message requires ${total} chunks; maximum is ${MAX_CHUNKS}`);
  const id = createId();
  const result: EncodedSupabaseMessage[] = [];
  for (let index = 0; index < total; index += 1) {
    const chunk = encoded.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    result.push({
      payload: {
        __partiSupabaseChunk: 1,
        id,
        index,
        total,
        bytes: chunk.byteLength,
        data: bytesToBase64(chunk),
      },
      encodedBytes: encoded.byteLength,
      chunkIndex: index,
      chunkTotal: total,
    });
  }
  return result;
}

export class SupabaseMessageReassembler {
  private readonly pending = new Map<string, PendingMessage>();

  constructor(
    private readonly onError: (reason: string) => void,
    private readonly timeoutMs = REASSEMBLY_TIMEOUT_MS,
  ) {}

  accept(payload: unknown): CommonProviderMessage | undefined {
    if (!isChunkMessage(payload)) return payload as CommonProviderMessage;
    const { id, index, total, bytes, data } = payload;
    if (id.length === 0 || id.length > 128 || total < 1 || total > MAX_CHUNKS
      || index < 0 || index >= total || bytes < 0 || bytes > CHUNK_BYTES) {
      throw new Error('invalid Supabase message chunk metadata');
    }

    let chunk: Uint8Array;
    try {
      chunk = base64ToBytes(data);
    } catch {
      throw new Error('invalid base64 in Supabase message chunk');
    }
    if (chunk.byteLength !== bytes) throw new Error('Supabase message chunk byte length mismatch');

    let entry = this.pending.get(id);
    if (!entry) {
      entry = {
        chunks: new Array(total),
        received: 0,
        bytes: 0,
        timer: setTimeout(() => {
          this.pending.delete(id);
          this.onError(`Supabase message reassembly timed out: id=${id}, received=${entry?.received ?? 0}/${total}`);
        }, this.timeoutMs),
      };
      this.pending.set(id, entry);
    } else if (entry.chunks.length !== total) {
      this.discard(id, entry);
      throw new Error('conflicting Supabase message chunk count');
    }

    const existing = entry.chunks[index];
    if (existing) {
      if (existing.byteLength !== chunk.byteLength
        || existing.some((byte, byteIndex) => byte !== chunk[byteIndex])) {
        this.discard(id, entry);
        throw new Error('conflicting duplicate Supabase message chunk');
      }
      return undefined;
    }

    entry.chunks[index] = chunk;
    entry.received += 1;
    entry.bytes += chunk.byteLength;
    if (entry.bytes > MAX_MESSAGE_BYTES) {
      this.discard(id, entry);
      throw new Error(`Supabase message exceeds ${MAX_MESSAGE_BYTES} bytes`);
    }
    if (entry.received !== total) return undefined;

    this.discard(id, entry);
    const combined = new Uint8Array(entry.bytes);
    let offset = 0;
    for (const part of entry.chunks) {
      if (!part) throw new Error('Supabase message is missing a chunk');
      combined.set(part, offset);
      offset += part.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(combined)) as CommonProviderMessage;
    } catch {
      throw new Error('invalid JSON in reassembled Supabase message');
    }
  }

  clear(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  private discard(id: string, entry: PendingMessage): void {
    clearTimeout(entry.timer);
    this.pending.delete(id);
  }
}
