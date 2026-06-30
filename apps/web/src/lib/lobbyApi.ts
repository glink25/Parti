export interface LobbyRoom {
  listingId: string;
  roomId: string;
  hostPeerId: string;
  title: string;
  packageName: string;
  playerCount: number;
  maxPlayers: number | null;
  joinable: boolean;
  credentialRequired: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export type LobbyRoomInput = Omit<
  LobbyRoom,
  'listingId' | 'createdAt' | 'updatedAt' | 'expiresAt'
>;

export interface LobbyLease {
  listingId: string;
  leaseToken: string;
  expiresAt: number;
}

export class LobbyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LobbyHttpError';
  }
}

export function lobbyServiceUrl(): string | null {
  const value = import.meta.env.VITE_LOBBY_SERVICE_URL?.trim();
  return value ? value.replace(/\/$/, '') : null;
}

export class LobbyClient {
  constructor(readonly baseUrl: string) {}

  async health(): Promise<void> {
    await this.request('/v1/health');
  }

  async listRooms(): Promise<LobbyRoom[]> {
    const data = await this.request<{ rooms: LobbyRoom[] }>('/v1/rooms');
    return data.rooms;
  }

  async createRoom(input: LobbyRoomInput): Promise<LobbyLease> {
    return this.request('/v1/rooms', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateRoom(lease: LobbyLease, input: LobbyRoomInput): Promise<LobbyLease> {
    return this.request(`/v1/rooms/${encodeURIComponent(lease.listingId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${lease.leaseToken}` },
      body: JSON.stringify(input),
    });
  }

  async deleteRoom(lease: LobbyLease): Promise<void> {
    await this.request(`/v1/rooms/${encodeURIComponent(lease.listingId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${lease.leaseToken}` },
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new LobbyHttpError(`大厅服务请求失败 (${response.status})`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

const LEASE_PREFIX = 'parti:lobby-lease:';

export class LobbyPublisher {
  private lease: LobbyLease | null;
  private input: LobbyRoomInput | null = null;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly roomId: string,
    private readonly client: LobbyClient,
    private readonly onStatus: (status: string) => void,
  ) {
    this.lease = loadLease(roomId);
  }

  async publish(input: LobbyRoomInput): Promise<void> {
    this.input = input;
    this.startHeartbeat();
    this.onStatus('正在上架…');
    await this.client.health();
    if (this.lease) {
      try {
        this.lease = await this.client.updateRoom(this.lease, input);
      } catch (error) {
        if (!(error instanceof LobbyHttpError) || error.status !== 404) throw error;
        this.lease = null;
      }
    }
    if (!this.lease) this.lease = await this.client.createRoom(input);
    saveLease(this.roomId, this.lease);
    this.onStatus('已公开');
  }

  async sync(input: LobbyRoomInput): Promise<void> {
    this.input = input;
    if (!this.lease) {
      try {
        await this.publish(input);
      } catch {
        this.onStatus('同步失败，将自动重试');
      }
      return;
    }
    try {
      this.lease = await this.client.updateRoom(this.lease, input);
      saveLease(this.roomId, this.lease);
      this.onStatus('已公开');
    } catch (error) {
      if (error instanceof LobbyHttpError && error.status === 404) {
        this.lease = null;
        clearLease(this.roomId);
        await this.publish(input);
        return;
      }
      this.onStatus('同步失败，将自动重试');
    }
  }

  async unpublish(): Promise<void> {
    this.stopHeartbeat();
    const lease = this.lease;
    this.lease = null;
    clearLease(this.roomId);
    if (lease) {
      try {
        await this.client.deleteRoom(lease);
      } catch {
        // 租约会在服务端自动过期。
      }
    }
    this.onStatus('私密');
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.timer = setInterval(() => {
      if (this.input) void this.sync(this.input);
    }, 20_000);
  }

  private stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function loadLease(roomId: string): LobbyLease | null {
  try {
    const raw = sessionStorage.getItem(LEASE_PREFIX + roomId);
    return raw ? (JSON.parse(raw) as LobbyLease) : null;
  } catch {
    return null;
  }
}

function saveLease(roomId: string, lease: LobbyLease): void {
  sessionStorage.setItem(LEASE_PREFIX + roomId, JSON.stringify(lease));
}

function clearLease(roomId: string): void {
  sessionStorage.removeItem(LEASE_PREFIX + roomId);
}
