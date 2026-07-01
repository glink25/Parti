/**
 * ReconnectingClient —— 玩家端「断线自动重连」管理器。
 *
 * 把易失的 ClientRuntime 包在一层稳定的 RoomClientPort 之后：transport 断开
 * （含房主刷新导致的掉线）时按退避策略用同一 hostPeerId + clientId 反复重连，
 * 内部替换底层 runtime，而 UI / iframe 桥无需感知 (GOAL §17 Phase 4)。
 *
 * 这是「核心机制托管现场恢复」的玩家侧落点：组件只拿到一个稳定 port，
 * 不接触 transport / storage / 重连细节。
 */
import {
  ClientRuntime,
  PARTI_VERSION,
  type ClientTransportSession,
} from '@parti/core';
import { PeerJSTransportAdapter } from '@parti/transport-peerjs';
import type { RoomClientPort } from '@parti/client-sdk';

export interface ReconnectingClientOptions {
  roomId: string;
  packageHash: string;
  hostPeerId: string;
  playerName: string;
  /** 稳定客户端身份 id（由入口层从 localStorage 用户身份取得）。 */
  clientId: string;
  credential?: string;
  /** 连接状态变化回调（connecting / connected / reconnecting / closed）。 */
  onStatus?: (status: string) => void;
  /** 不可恢复错误（被踢、版本不一致等）回调，不再重连。 */
  onFatal?: (message: string) => void;
}

const MAX_BACKOFF_MS = 5000;

export class ReconnectingClient {
  readonly port: RoomClientPort;

  private runtime?: ClientRuntime;
  private transport?: ClientTransportSession;
  private innerOff: Array<() => void> = [];
  private retryHandle?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private disposed = false;

  // 稳定 port 自持的订阅集合，跨 runtime 替换始终有效。
  private readonly stateCbs = new Set<(s: unknown) => void>();
  private readonly eventCbs = new Set<(e: string, p: unknown) => void>();
  private readonly readyCbs = new Set<() => void>();
  private lastState: unknown = null;
  private hasState = false;
  private welcomed = false;
  private playerId = '';

  constructor(private readonly opts: ReconnectingClientOptions) {
    this.port = {
      isReady: () => this.welcomed && this.hasState,
      onReady: (cb) => {
        this.readyCbs.add(cb);
        if (this.welcomed && this.hasState) cb();
        return () => this.readyCbs.delete(cb);
      },
      getPlayerId: () => this.playerId,
      getState: () => this.lastState,
      submitAction: (action, payload) =>
        this.runtime?.submitAction(action, payload),
      ready: () => this.runtime?.ready(),
      leave: () => this.dispose(),
      onState: (cb) => {
        this.stateCbs.add(cb);
        return () => this.stateCbs.delete(cb);
      },
      onEvent: (cb) => {
        this.eventCbs.add(cb);
        return () => this.eventCbs.delete(cb);
      },
    };
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.disposed) return;
    this.cleanupRuntime();
    this.opts.onStatus?.(this.attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      const adapter = new PeerJSTransportAdapter();
      const transport = await adapter.joinRoom({
        roomId: this.opts.roomId,
        hostConnectionInfo: this.opts.hostPeerId,
      });
      const runtime = new ClientRuntime({
        roomId: this.opts.roomId,
        partiVersion: PARTI_VERSION,
        packageHash: this.opts.packageHash,
        transport,
        playerName: this.opts.playerName,
        clientId: this.opts.clientId,
        ...(this.opts.credential !== undefined
          ? { credential: this.opts.credential }
          : {}),
      });
      this.transport = transport;
      this.bind(runtime);
      await runtime.start();
    } catch {
      this.scheduleRetry();
    }
  }

  private bind(runtime: ClientRuntime): void {
    this.runtime = runtime;
    this.innerOff.push(
      runtime.welcome.on(() => {
        this.welcomed = true;
        this.attempt = 0;
        // 重连复用原 playerId（host 据 clientId 回带），故只在首次设定。
        if (!this.playerId) this.playerId = runtime.getPlayerId();
        this.fireReady();
      }),
      runtime.stateChanged.on((snap) => {
        this.lastState = snap.state;
        this.hasState = true;
        for (const cb of [...this.stateCbs]) cb(snap.state);
        this.fireReady();
      }),
      runtime.event.on((e) => {
        for (const cb of [...this.eventCbs]) cb(e.event, e.payload);
      }),
      runtime.statusChanged.on((s) => this.opts.onStatus?.(s)),
      runtime.errors.on((e) => {
        if (this.disposed) return;
        if (e.recoverable) {
          this.scheduleRetry();
        } else {
          this.opts.onFatal?.(`${e.code}: ${e.message}`);
          this.cleanupRuntime();
        }
      }),
    );
  }

  private fireReady(): void {
    if (this.welcomed && this.hasState) {
      for (const cb of [...this.readyCbs]) cb();
    }
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryHandle) return;
    const wait = Math.min(500 * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.opts.onStatus?.('reconnecting');
    this.retryHandle = setTimeout(() => {
      this.retryHandle = undefined;
      void this.connect();
    }, wait);
  }

  private cleanupRuntime(): void {
    for (const off of this.innerOff) off();
    this.innerOff = [];
    try {
      this.transport?.close();
    } catch {
      // ignore
    }
    this.transport = undefined;
    this.runtime?.dispose();
    this.runtime = undefined;
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryHandle) {
      clearTimeout(this.retryHandle);
      this.retryHandle = undefined;
    }
    this.cleanupRuntime();
    this.opts.onStatus?.('closed');
  }
}
