import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LobbyClient,
  LobbyHttpError,
  LobbyPublisher,
  type LobbyLease,
  type LobbyRoomInput,
} from './lobbyApi.js';
import { buildInviteUrl, parseInviteInput, parsePeerRoute } from './peerRoutes.js';
import type { TransportConfig } from './transportConfig.js';

const input: LobbyRoomInput = {
  roomId: 'counter',
  hostPeerId: 'peer/one',
  title: '测试房间',
  packageName: '计数器',
  playerCount: 1,
  maxPlayers: 4,
  joinable: true,
  credentialRequired: true,
};

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

class FakeLobbyClient extends LobbyClient {
  lease: LobbyLease = { listingId: 'listing-1', leaseToken: 'token-1', expiresAt: 1 };
  creates = 0;
  updates = 0;
  deletes = 0;
  failUpdateWith404 = false;

  constructor() { super('https://lobby.test'); }
  override async health(): Promise<void> {}
  override async createRoom(): Promise<LobbyLease> {
    this.creates += 1;
    return this.lease;
  }
  override async updateRoom(): Promise<LobbyLease> {
    this.updates += 1;
    if (this.failUpdateWith404) {
      this.failUpdateWith404 = false;
      throw new LobbyHttpError('missing', 404);
    }
    return this.lease;
  }
  override async deleteRoom(): Promise<void> { this.deletes += 1; }
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe('peer routes', () => {
  it('encodes and parses password invite links', () => {
    const url = buildInviteUrl('https://parti.test', '/app/', 'room id', 'peer/one', '0123');
    expect(url).toBe('https://parti.test/app/#/online/join/room%20id/peer%2Fone?adapter=peerjs&password=0123');
    expect(parsePeerRoute('#/peer/join/room%20id/peer%2Fone?password=0123')).toMatchObject({
      mode: 'join',
      roomId: 'room id',
      hostPeerId: 'peer/one',
      credential: '0123',
    });
  });

  it('parses invite input from full URL, hash, and path', () => {
    const expected = '/online/join/room%20id/peer%2Fone?adapter=peerjs&password=0123';
    expect(parseInviteInput('https://parti.test/app/#/peer/join/room%20id/peer%2Fone?password=0123')).toBe(expected);
    expect(parseInviteInput('#/peer/join/room%20id/peer%2Fone?password=0123')).toBe(expected);
    expect(parseInviteInput('/peer/join/counter/peer%2Fabc')).toBe('/online/join/counter/peer%2Fabc?adapter=peerjs');
  });

  it('round-trips a portable Supabase common transport link', () => {
    const config: TransportConfig = {
      adapter: 'common', provider: 'supabase', url: 'https://project.supabase.co', publishableKey: 'sb_publishable_public',
    };
    const url = buildInviteUrl('https://parti.test', '/', 'counter', 'opaque-info', '', config);
    expect(parsePeerRoute(new URL(url).hash)).toMatchObject({
      mode: 'join', roomId: 'counter', hostPeerId: 'opaque-info', transportConfig: config,
    });
    expect(parseInviteInput(url)).toContain('adapter=common&provider=supabase');
  });

  it('rejects unsafe common transport links', () => {
    expect(parseInviteInput('#/online/join/room/info?adapter=common&provider=supabase&url=http%3A%2F%2Fevil.test&key=sb_publishable_x')).toBeNull();
    expect(parseInviteInput('#/online/join/room/info?adapter=common&provider=supabase&url=https%3A%2F%2Fproject.supabase.co&key=sb_secret_x')).toBeNull();
  });

  it('returns null for invalid invite input', () => {
    expect(parseInviteInput('')).toBeNull();
    expect(parseInviteInput('https://example.com/')).toBeNull();
    expect(parseInviteInput('#/peer/join/room-only')).toBeNull();
    expect(parseInviteInput('#/editor')).toBeNull();
    expect(parseInviteInput('这不是一个有效的邀请链接')).toBeNull();
  });

  it('extracts invite URL from surrounding share text', () => {
    const expected = '/online/join/room%20id/peer%2Fone?adapter=peerjs&password=0123';
    const url = 'https://parti.test/app/#/peer/join/room%20id/peer%2Fone?password=0123';
    expect(parseInviteInput(`快来加入：${url}`)).toBe(expected);
    expect(parseInviteInput(`邀请链接：${url}。`)).toBe(expected);
    expect(parseInviteInput(`Join us ${url} now`)).toBe(expected);
    expect(parseInviteInput(`链接 /peer/join/counter/peer%2Fabc 在这里`)).toBe('/online/join/counter/peer%2Fabc?adapter=peerjs');
    expect(parseInviteInput(`复制此链接 #/peer/join/counter/peer%2Fabc 加入`)).toBe('/online/join/counter/peer%2Fabc?adapter=peerjs');
  });
});

describe('LobbyPublisher', () => {
  it('registers, heartbeats, recreates missing leases, and unpublishes', async () => {
    const client = new FakeLobbyClient();
    const statuses: string[] = [];
    const publisher = new LobbyPublisher('counter', client, (status) => statuses.push(status));

    await publisher.publish(input);
    expect(client.creates).toBe(1);
    client.failUpdateWith404 = true;
    await publisher.sync({ ...input, playerCount: 2 });
    expect(client.creates).toBe(2);

    await publisher.unpublish();
    expect(client.deletes).toBe(1);
    expect(statuses.at(-1)).toBe('private');
  });
});
