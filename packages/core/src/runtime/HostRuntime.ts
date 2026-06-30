/**
 * HostRuntime —— 权威主机编排 (GOAL.md §6.1, §10.3)。
 *
 * 职责：
 *  - 持有 HostTransportSession（玩家连接）+ RoomWorkerHost（房间逻辑）+ PlayerManager。
 *  - 把入站协议消息翻译成 worker 输入；把 worker 副作用翻译成出站协议消息。
 *  - 维护权威 state 版本（StateSyncEngine, snapshot 模式）。
 *  - host 自身也是一名 player，但走「本地直连」而非 transport。
 *
 * 创作者代码（room.worker.js）完全感知不到 transport / seq / ack（§9.1）。
 */
import { RoomError } from '../errors.js';
import { PlayerManager, type Player } from '../players.js';
import { createMessage, generateId, SeqCounter } from '../protocol/factory.js';
import {
  PROTOCOL_VERSION,
  type ActionPayload,
  type EventPayload,
  type HelloPayload,
  type ReadyPayload,
  type RoomErrorPayload,
  type RoomMessage,
  type SnapshotPayload,
  type WelcomePayload,
} from '../protocol/messages.js';
import { StateSyncEngine } from '../state/sync.js';
import type { SessionStore } from '../session/SessionStore.js';
import type {
  HostTransportSession,
  PeerId,
  TransportMessage,
} from '../transport/types.js';
import { Emitter } from '../util/emitter.js';
import type { RoomWorkerHost } from './worker-host.js';
import type { MessageLogEntry } from './types.js';

export interface HostRuntimeOptions {
  roomId: string;
  partiVersion: string;
  packageHash: string;
  transport: HostTransportSession;
  worker: RoomWorkerHost;
  /** room.worker.js 源码 */
  roomSource: string;
  /** 房间配置 / manifest */
  manifest?: unknown;
  /** host 玩家展示名 */
  hostName?: string;
  /**
   * 可选会话存储。提供后 Runtime 自动持久化权威快照 + 玩家身份映射，
   * 并在重启时据此水合恢复（GOAL §17 Phase 4）。创作者无需感知。
   */
  store?: SessionStore;
  /** 可选：复用稳定的 host player id（缺省时从 store 恢复或新生成）。 */
  hostPlayerId?: string;
  /** 玩家掉线后的保留宽限期（毫秒），期满才真正离开。默认 30000。 */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 30_000;

export class HostRuntime {
  readonly roomId: string;
  private readonly opts: HostRuntimeOptions;
  private readonly transport: HostTransportSession;
  private readonly worker: RoomWorkerHost;
  private readonly players = new PlayerManager();
  private readonly sync = new StateSyncEngine();
  private readonly seq = new SeqCounter();
  private readonly createdAt = Date.now();
  /** 掉线玩家的宽限期定时器，key = playerId。 */
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 已持久化的状态版本，用于避免重复写盘。 */
  private lastPersistedVersion = -1;
  /** 是否已销毁；销毁后忽略一切入站/断线事件，避免把已清除的会话写回。 */
  private disposed = false;

  private hostPlayer!: Player;

  // DevTools / 本地 host UI 订阅点
  readonly messageLog = new Emitter<MessageLogEntry>();
  readonly playersChanged = new Emitter<Player[]>();
  readonly logs = new Emitter<unknown[]>();
  readonly errors = new Emitter<RoomErrorPayload>();
  /** host 自身 UI 的 state / event 流（不走 transport） */
  readonly localState = new Emitter<SnapshotPayload>();
  readonly localEvent = new Emitter<EventPayload>();

  constructor(options: HostRuntimeOptions) {
    this.opts = options;
    this.roomId = options.roomId;
    this.transport = options.transport;
    this.worker = options.worker;
  }

  get connectionInfo(): string {
    return this.transport.connectionInfo;
  }

  getHostPlayerId(): string {
    return this.hostPlayer.id;
  }

  listPlayers(): Player[] {
    return this.players.list();
  }

  currentSnapshot(): SnapshotPayload {
    return this.sync.currentSnapshot();
  }

  async start(): Promise<void> {
    // 0. 尝试从持久化会话恢复（房主刷新后水合，§17 Phase 4）
    const restored = this.opts.store?.loadRoom(this.roomId) ?? null;
    const isRestore = restored !== null;

    // 1. host 作为一名玩家加入（恢复时复用稳定的 host player id）
    this.hostPlayer = this.players.add({
      id:
        this.opts.hostPlayerId ?? restored?.hostPlayerId ?? generateId('player'),
      peerId: this.transport.selfId,
      name: this.opts.hostName ?? 'Host',
      role: 'host',
      status: 'connected',
      joinedAt: Date.now(),
    });

    // 2. 绑定 worker 副作用回调
    this.worker.setCallbacks({
      onState: (state) => this.handleState(state),
      onBroadcast: (event, payload) => this.handleBroadcast(event, payload),
      onSend: (playerId, event, payload) =>
        this.handleSend(playerId, event, payload),
      onKick: (playerId, reason) => this.handleKick(playerId, reason),
      onLog: (args) => this.logs.emit(args),
      onError: (error) =>
        this.emitError({
          code: 'RUNTIME_ERROR',
          message: error.message,
          recoverable: false,
          detail: error.stack,
        }),
    });

    // 3. 初始化 worker：恢复时用持久化快照水合，否则建立 initialState
    await this.worker.init({
      roomId: this.roomId,
      roomSource: this.opts.roomSource,
      manifest: this.opts.manifest,
      host: this.hostPlayer,
      ...(isRestore ? { restoreState: restored.snapshot.state } : {}),
    });

    if (isRestore) {
      // 把同步引擎预置到持久化版本，避免客户端因版本回退而忽略后续更新。
      this.sync.restore(restored.snapshot);
      this.lastPersistedVersion = restored.snapshot.version;
      // 重新登记上次在场的玩家为「离线」，使其凭 clientId 回归时被识别。
      // 同时给一个宽限期，长期不回归则清理。
      for (const p of restored.players) {
        const offlinePlayer = this.players.add({
          id: p.playerId,
          peerId: `offline:${p.clientId}`,
          clientId: p.clientId,
          name: p.name,
          role: p.role,
          status: 'offline',
          joinedAt: Date.now(),
        });
        this.scheduleGrace(offlinePlayer.id);
      }
    }

    // 4. host 自身：恢复走 reconnect（保留其在快照中的数据），否则 onJoin
    if (isRestore) {
      this.worker.reconnect(this.hostPlayer);
    } else {
      this.worker.join(this.hostPlayer);
    }

    // 5. 监听 transport
    this.transport.onConnection((peer) => this.onConnection(peer.id));
    this.transport.onMessage((peerId, msg) => this.onTransportMessage(peerId, msg));
    this.transport.onDisconnect((peerId, reason) => this.onDisconnect(peerId, reason));

    this.persist();
    this.playersChanged.emit(this.players.list());
  }

  // --- host 本地 UI 入口（host-bridge 调用，不经 transport） ---

  localReady(): void {
    this.players.setStatus(this.hostPlayer.id, 'ready');
    this.worker.ready(this.hostPlayer);
    this.playersChanged.emit(this.players.list());
  }

  submitLocalAction(action: string, payload: unknown): void {
    const actionId = generateId('action');
    this.worker.dispatchAction(this.hostPlayer, action, payload, actionId);
  }

  // --- transport 入站 ---

  private onConnection(peerId: PeerId): void {
    // 实际的玩家创建发生在 sys:hello；这里仅占位日志。
    this.logs.emit([`[host] peer connected: ${peerId}`]);
  }

  private onTransportMessage(peerId: PeerId, tm: TransportMessage): void {
    if (this.disposed) return;
    const message = tm.data as RoomMessage;
    this.messageLog.emit({ dir: 'in', message, at: Date.now() });
    try {
      this.routeInbound(peerId, message);
    } catch (err) {
      const error =
        err instanceof RoomError
          ? err.toPayload()
          : {
              code: 'RUNTIME_ERROR' as const,
              message: err instanceof Error ? err.message : String(err),
              recoverable: false,
            };
      this.sendToPeer(peerId, 'sys', 'sys:error', error, peerId);
      this.emitError(error);
    }
  }

  private routeInbound(peerId: PeerId, message: RoomMessage): void {
    switch (message.type) {
      case 'sys:hello':
        this.handleHello(peerId, message.payload as HelloPayload);
        break;
      case 'sys:ready':
        this.handleReady(peerId, message.payload as ReadyPayload);
        break;
      case 'game:action':
        this.handleAction(peerId, message.payload as ActionPayload);
        break;
      case 'sys:pong':
        break;
      case 'sys:resync-request':
        this.sendToPeer(
          peerId,
          'state',
          'state:snapshot',
          this.sync.currentSnapshot(),
        );
        break;
      default:
        this.logs.emit([`[host] 未处理消息类型: ${message.type}`]);
    }
  }

  private handleHello(peerId: PeerId, hello: HelloPayload): void {
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      throw new RoomError(
        'VERSION_MISMATCH',
        `协议版本不匹配: host=${PROTOCOL_VERSION} client=${hello.protocolVersion}`,
        { recoverable: false },
      );
    }
    if (hello.roomPackageHash !== this.opts.packageHash) {
      throw new RoomError(
        'VERSION_MISMATCH',
        '房间代码包 hash 不一致',
        { recoverable: false, detail: { expected: this.opts.packageHash } },
      );
    }

    // 重连路径：clientId 命中已有/离线玩家 → 复用其原 playerId，不走 new-join。
    const clientId = hello.player.clientId;
    const returning = clientId ? this.players.getByClient(clientId) : undefined;
    if (returning) {
      this.cancelGrace(returning.id);
      this.players.rebindPeer(returning.id, peerId);
      this.players.setStatus(returning.id, 'connected');
      const newName = hello.player.name?.trim();
      if (newName) returning.name = newName;

      this.sendWelcome(peerId, returning);
      this.worker.reconnect(returning);
      this.broadcastEvent('player:rejoined', {
        id: returning.id,
        name: returning.name,
      });
      this.persist();
      this.playersChanged.emit(this.players.list());
      return;
    }

    const player = this.players.add({
      id: generateId('player'),
      peerId,
      ...(clientId ? { clientId } : {}),
      name: hello.player.name?.trim() || `Player-${this.players.count()}`,
      role: 'player',
      status: 'connected',
      ...(hello.player.avatar ? { avatar: hello.player.avatar } : {}),
      joinedAt: Date.now(),
    });

    this.sendWelcome(peerId, player);
    this.worker.join(player);
    this.broadcastEvent('player:joined', { id: player.id, name: player.name });
    this.persist();
    this.playersChanged.emit(this.players.list());
  }

  /** 向某 peer 下发 sys:welcome + 当前 state:snapshot（首次加入 / 重连共用）。 */
  private sendWelcome(peerId: PeerId, player: Player): void {
    const welcome: WelcomePayload = {
      playerId: player.id,
      role: player.role,
      room: {
        id: this.roomId,
        packageHash: this.opts.packageHash,
        createdAt: this.createdAt,
      },
      players: this.players.toWelcomeList(),
      stateVersion: this.sync.getVersion(),
    };
    this.sendToPeer(peerId, 'sys', 'sys:welcome', welcome, peerId);
    this.sendToPeer(
      peerId,
      'state',
      'state:snapshot',
      this.sync.currentSnapshot(),
      peerId,
    );
  }

  private handleReady(peerId: PeerId, _ready: ReadyPayload): void {
    const player = this.players.getByPeer(peerId);
    if (!player) return;
    this.players.setStatus(player.id, 'ready');
    this.worker.ready(player);
    this.playersChanged.emit(this.players.list());
  }

  private handleAction(peerId: PeerId, action: ActionPayload): void {
    const player = this.players.getByPeer(peerId);
    if (!player) {
      throw new RoomError('FORBIDDEN', '未加入房间的玩家不能发送 action');
    }
    this.worker.dispatchAction(
      player,
      action.action,
      action.payload,
      action.clientActionId,
    );
  }

  private onDisconnect(peerId: PeerId, _reason?: string): void {
    if (this.disposed) return;
    const player = this.players.getByPeer(peerId);
    if (!player) return;
    // 软离线：保留玩家对象与其房间内数据，给一个宽限期等待重连 (§17 Phase 4)。
    this.players.setStatus(player.id, 'offline');
    this.broadcastEvent('player:offline', { id: player.id });
    this.scheduleGrace(player.id);
    this.persist();
    this.playersChanged.emit(this.players.list());
  }

  /** 为离线玩家启动宽限期定时器；期满仍未重连则真正离开。 */
  private scheduleGrace(playerId: string): void {
    this.cancelGrace(playerId);
    const ms = this.opts.graceMs ?? DEFAULT_GRACE_MS;
    const handle = setTimeout(() => {
      this.graceTimers.delete(playerId);
      const player = this.players.get(playerId);
      if (!player || player.status !== 'offline') return;
      this.worker.leave(player);
      this.players.remove(playerId);
      this.broadcastEvent('player:left', { id: playerId });
      this.persist();
      this.playersChanged.emit(this.players.list());
    }, ms);
    this.graceTimers.set(playerId, handle);
  }

  private cancelGrace(playerId: string): void {
    const handle = this.graceTimers.get(playerId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.graceTimers.delete(playerId);
    }
  }

  // --- worker 副作用出站 ---

  private handleState(state: unknown): void {
    const snapshot = this.sync.commit(state);
    this.broadcastSnapshot(snapshot);
    // 仅在版本实际变化时写盘，天然节流到「真实状态变更」频率。
    if (this.opts.store && snapshot.version !== this.lastPersistedVersion) {
      this.persist();
    }
  }

  /** 持久化当前会话（稳定身份 + 最新快照 + 玩家映射）。 */
  private persist(): void {
    if (this.disposed) return;
    const store = this.opts.store;
    if (!store || !this.hostPlayer) return;
    const snapshot = this.sync.currentSnapshot();
    const players = this.players
      .list()
      .filter((p) => p.role !== 'host' && p.clientId)
      .map((p) => ({
        clientId: p.clientId as string,
        playerId: p.id,
        name: p.name,
        role: p.role,
      }));
    store.saveRoom({
      roomId: this.roomId,
      hostPeerId: this.transport.connectionInfo,
      hostPlayerId: this.hostPlayer.id,
      snapshot,
      players,
      updatedAt: Date.now(),
    });
    this.lastPersistedVersion = snapshot.version;
  }

  private handleBroadcast(event: string, payload: unknown): void {
    this.broadcastEvent(event, payload);
  }

  private handleSend(playerId: string, event: string, payload: unknown): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const eventPayload: EventPayload = { event, payload };
    if (player.id === this.hostPlayer.id) {
      this.localEvent.emit(eventPayload);
    } else {
      this.sendToPeer(player.peerId, 'event', 'game:event', eventPayload, player.id);
    }
  }

  private handleKick(playerId: string, reason: string | undefined): void {
    const player = this.players.get(playerId);
    if (!player || player.id === this.hostPlayer.id) return;
    this.sendToPeer(
      player.peerId,
      'sys',
      'sys:kick',
      { reason },
      player.id,
    );
    this.cancelGrace(playerId);
    this.players.remove(playerId);
    this.persist();
    this.playersChanged.emit(this.players.list());
  }

  // --- 出站工具 ---

  private broadcastSnapshot(snapshot: SnapshotPayload): void {
    this.localState.emit(snapshot);
    for (const player of this.players.list()) {
      if (player.id === this.hostPlayer.id) continue;
      this.sendToPeer(
        player.peerId,
        'state',
        'state:snapshot',
        snapshot,
        player.id,
      );
    }
  }

  private broadcastEvent(event: string, payload: unknown): void {
    const eventPayload: EventPayload = { event, payload };
    this.localEvent.emit(eventPayload);
    for (const player of this.players.list()) {
      if (player.id === this.hostPlayer.id) continue;
      this.sendToPeer(
        player.peerId,
        'event',
        'game:event',
        eventPayload,
        player.id,
      );
    }
  }

  private sendToPeer(
    peerId: PeerId,
    channel: RoomMessage['channel'],
    type: string,
    payload: unknown,
    toPlayerId?: string,
  ): void {
    const message = createMessage({
      roomId: this.roomId,
      from: this.hostPlayer?.id ?? 'host',
      to: toPlayerId,
      seq: this.seq.next(),
      channel,
      type,
      payload,
    });
    this.transport.send(peerId, { data: message, meta: { reliable: true, ordered: true } });
    this.messageLog.emit({ dir: 'out', message, at: Date.now() });
  }

  private emitError(error: RoomErrorPayload): void {
    this.errors.emit(error);
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.graceTimers.values()) clearTimeout(handle);
    this.graceTimers.clear();
    this.worker.dispose();
    this.transport.close();
    this.messageLog.clear();
    this.playersChanged.clear();
    this.logs.clear();
    this.errors.clear();
    this.localState.clear();
    this.localEvent.clear();
  }
}
