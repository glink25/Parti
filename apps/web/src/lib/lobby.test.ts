import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LobbyClient,
  LobbyHttpError,
  LobbyPublisher,
  type LobbyLease,
  type LobbyRoomInput,
} from './lobbyApi.js';
import { buildInviteUrl, parsePeerRoute } from './peerRoutes.js';

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
    expect(url).toBe('https://parti.test/app/#/peer/join/room%20id/peer%2Fone?password=0123');
    expect(parsePeerRoute('#/peer/join/room%20id/peer%2Fone?password=0123')).toMatchObject({
      mode: 'join',
      roomId: 'room id',
      hostPeerId: 'peer/one',
      credential: '0123',
    });
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
    expect(statuses.at(-1)).toBe('私密');
  });
});
