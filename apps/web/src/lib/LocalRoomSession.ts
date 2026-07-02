/**
 * LocalRoomSession —— 在单页内用 LocalTransportAdapter 起一个 Host + 若干虚拟
 * 玩家，用于编辑器/大厅的「本地多人预览」(GOAL.md §15.2)。
 *
 * Host 的房间逻辑运行在真实 Web Worker（WebWorkerHost）中；玩家通过内存
 * transport 加入。每个参与者（含 host 自己）都通过 client-sdk 桥渲染 Room UI。
 */
import { ClientRuntime, HostRuntime, PARTI_VERSION } from '@parti/core';
import {
  createClientPort,
  createHostLocalPort,
  type RoomClientPort,
} from '@parti/client-sdk';
import { LocalTransportAdapter } from '@parti/transport-local';
import {
  getRoomHtml,
  getWorkerSource,
  type RoomPackage,
} from '@parti/room-packager';
import { createWebWorkerHost } from './roomWorker';
import { loadLocalUser } from './localUser';

const ROOM_ID = 'local-preview';

export class LocalRoomSession {
  readonly roomHtml: string;
  private readonly clients: ClientRuntime[] = [];

  private constructor(
    readonly pkg: RoomPackage,
    readonly host: HostRuntime,
    private readonly adapter: LocalTransportAdapter,
  ) {
    this.roomHtml = getRoomHtml(pkg);
  }

  static async create(pkg: RoomPackage): Promise<LocalRoomSession> {
    const user = loadLocalUser();
    const adapter = new LocalTransportAdapter();
    const transport = await adapter.createHost({ roomId: ROOM_ID, hostId: 'host' });
    const host = new HostRuntime({
      roomId: ROOM_ID,
      partiVersion: PARTI_VERSION,
      packageHash: pkg.packageHash,
      transport,
      worker: createWebWorkerHost(),
      roomSource: getWorkerSource(pkg),
      manifest: pkg.manifest,
      hostName: user.name,
      hostClientId: user.id,
      ...(pkg.manifest.room?.maxPlayers !== undefined
        ? { maxPlayers: pkg.manifest.room.maxPlayers }
        : {}),
    });
    await host.start();
    return new LocalRoomSession(pkg, host, adapter);
  }

  hostPort(): RoomClientPort {
    return createHostLocalPort(this.host);
  }

  /** 加入一名虚拟玩家，返回其 UI 端口。 */
  async addPlayer(name: string): Promise<RoomClientPort> {
    const transport = await this.adapter.joinRoom({
      roomId: ROOM_ID,
      hostConnectionInfo: this.host.connectionInfo,
    });
    const runtime = new ClientRuntime({
      roomId: ROOM_ID,
      partiVersion: PARTI_VERSION,
      packageHash: this.pkg.packageHash,
      transport,
      playerName: name,
    });
    this.clients.push(runtime);
    const port = createClientPort(runtime);
    await runtime.start();
    return port;
  }

  dispose(): void {
    for (const c of this.clients) c.dispose();
    this.host.dispose();
  }
}
