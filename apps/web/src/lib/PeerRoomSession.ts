/**
 * PeerJS 联机会话辅助：host 创建房间 / player 通过邀请加入。
 *
 * 关键点：host 与 player 加载同一个 Room Package（同一 baseUrl），因此
 * packageHash 一致，sys:hello 时校验通过——验证「换 transport 而创作者代码
 * 与协议不变」(§17 Phase 2/5)。
 *
 * 重连/持久化作为内置核心机制在此封装：组件只调用这两个函数即获得
 * 「房主刷新邀请链接不变 + 状态恢复」「玩家刷新/掉线自动重连」能力，
 * 全程不接触 sessionStorage (GOAL §17 Phase 4)。
 */
import {
  HostRuntime,
  PARTI_VERSION,
  SessionStorageStore,
  type RoomAdmissionController,
} from '@parti/core';
import { type RoomClientPort } from '@parti/client-sdk';
import {
  getRoomHtml,
  getWorkerSource,
  encodeFilesBase64,
  type RoomPackage,
} from '@parti/room-packager';
import { createWebWorkerHost } from './roomWorker.js';
import { ReconnectingClient } from './ReconnectingClient.js';
import { clearHostRoomSettings } from './roomSettings.js';
import { loadLocalUser } from './localUser.js';
import { createTransportAdapter, type TransportConfig } from './transportConfig.js';

/**
 * 当前页面内活跃的房间会话清理器（host 或 client），key = roomId。
 * 用于「退出到大厅」时先销毁仍在运行的 runtime，再清除存储——
 * 避免存活的 host 在清除后又把状态重新写回 sessionStorage。
 */
const activeDisposers = new Map<string, Set<() => void>>();

export function registerRoomDisposer(roomId: string, dispose: () => void): () => void {
  const disposers = activeDisposers.get(roomId) ?? new Set<() => void>();
  disposers.add(dispose);
  activeDisposers.set(roomId, disposers);
  return () => disposers.delete(dispose);
}

/**
 * 清除某房间的持久化会话（先销毁活跃 runtime，再清房间快照 + 玩家身份）。
 * 在「退出房间回到大厅」时调用，确保后续再进入该房间使用全新数据。
 * 刷新页面是整页重载、不触发此清除，因此刷新仍能恢复现场
 * （恢复与否完全依赖 sessionStorage 生命周期）。
 */
export function clearRoomSession(roomId: string): void {
  const disposers = activeDisposers.get(roomId);
  if (disposers) {
    activeDisposers.delete(roomId);
    for (const dispose of disposers) dispose();
  }
  const store = new SessionStorageStore();
  store.clearRoom(roomId);
  store.clearClientId(roomId);
  clearHostRoomSettings(roomId);
}

export interface PeerHost {
  host: HostRuntime;
  roomHtml: string;
  hostPeerId: string;
  packageHash: string;
  dispose(): void;
}

export interface PeerHostOptions {
  admissionController?: RoomAdmissionController;
  transportConfig: TransportConfig;
}

export async function createPeerHost(
  pkg: RoomPackage,
  options: PeerHostOptions,
): Promise<PeerHost> {
  const store = new SessionStorageStore();
  const user = loadLocalUser();
  const roomId = pkg.manifest.id;
  // 恢复与否完全交给 sessionStorage：刷新时记录仍在 → 恢复现场；关闭标签页或
  // 退出到大厅（已 clearRoomSession）后记录不在 → 全新房间。
  // 复用上次的稳定 host peer id（即邀请码），使刷新后邀请链接不变。
  const restored = store.loadRoom(roomId);
  const adapter = await createTransportAdapter(options.transportConfig);
  const transport = await adapter.createHost({
    roomId,
    ...(restored?.hostPeerId ? { hostId: restored.hostPeerId } : {}),
  });
  const host = new HostRuntime({
    roomId,
    partiVersion: PARTI_VERSION,
    packageHash: pkg.packageHash,
    transport,
    worker: createWebWorkerHost(),
    roomSource: getWorkerSource(pkg),
    manifest: pkg.manifest,
    // 透传全部文件，使 host 能响应加入者的 sys:package-request 点对点下发房间代码。
    packageFiles: encodeFilesBase64(pkg.files),
    hostName: user.name,
    hostClientId: user.id,
    store,
    ...(options.admissionController
      ? { admissionController: options.admissionController }
      : {}),
    ...(pkg.manifest.room?.maxPlayers !== undefined
      ? { maxPlayers: pkg.manifest.room.maxPlayers }
      : {}),
  });

  // 刷新/关闭时主动销毁 peer，尽快释放稳定 id 供下次复用。
  const onUnload = () => host.dispose();
  window.addEventListener('beforeunload', onUnload);

  await host.start();

  const dispose = () => {
    window.removeEventListener('beforeunload', onUnload);
    host.dispose();
  };
  registerRoomDisposer(roomId, dispose);

  return {
    host,
    roomHtml: getRoomHtml(pkg),
    hostPeerId: transport.connectionInfo,
    packageHash: pkg.packageHash,
    dispose,
  };
}

export interface PeerJoin {
  client: ReconnectingClient;
  port: RoomClientPort;
  roomHtml: string;
}

export interface PeerJoinHandlers {
  onStatus?: (status: string) => void;
  onFatal?: (message: string) => void;
}

export function createPeerJoin(
  pkg: RoomPackage,
  hostPeerId: string,
  transportConfig: TransportConfig,
  handlers: PeerJoinHandlers = {},
  credential?: string,
): PeerJoin {
  const roomId = pkg.manifest.id;
  const user = loadLocalUser();

  const client = new ReconnectingClient({
    roomId,
    packageHash: pkg.packageHash,
    hostPeerId,
    transportConfig,
    playerName: user.name,
    clientId: user.id,
    ...(credential !== undefined ? { credential } : {}),
    ...(handlers.onStatus ? { onStatus: handlers.onStatus } : {}),
    ...(handlers.onFatal ? { onFatal: handlers.onFatal } : {}),
  });
  registerRoomDisposer(roomId, () => client.dispose());

  return { client, port: client.port, roomHtml: getRoomHtml(pkg) };
}
