/**
 * 宿主页侧的 UI 沙箱桥 (GOAL.md §10.3)。
 *
 * UISandboxBridge 把一个 sandbox iframe 的 postMessage 通道连接到一个
 * RoomClientPort —— 后者抽象了「host 自己的本地玩家」与「远端 ClientRuntime」，
 * 因此同一段 Room UI 代码在 host 与 player 端运行完全一致。
 */
import type { HostRuntime, ClientRuntime } from '@parti/core';
import { CLIENT_SDK_SCRIPT } from './bootstrap';
import type { HostToUi, OrientationData, OrientationStatus, UiToHost } from './protocol';

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

class HostOrientationController {
  private status: OrientationStatus;
  private noDataTimer: ReturnType<typeof setTimeout> | undefined;
  private listening = false;
  private pendingRequestId: number | undefined;

  constructor(
    private readonly emit: (msg: HostToUi) => void,
    private readonly needsHostGesture: () => void,
    private readonly sensors: readonly string[],
    private readonly onStatusChange?: (status: OrientationStatus) => void,
  ) {
    this.status = this.detectInitialStatus();
    this.onStatusChange?.(this.status);
  }

  announce(): void { this.emit({ __parti: true, type: 'orientation-status', status: this.status }); }

  request(requestId?: number, hostGesture = false): void {
    if (this.status === 'unsupported' || this.status === 'blocked-by-policy') {
      this.emitStatus(this.status, requestId);
      return;
    }
    const Orientation = window.DeviceOrientationEvent as OrientationEventConstructor | undefined;
    const requestPermission = Orientation?.requestPermission;
    if (this.status === 'active' || this.status === 'no-data') {
      this.startListening();
      this.emitStatus(this.status, requestId);
      return;
    }
    if (!requestPermission) {
      this.startListening();
      this.emitStatus('no-data', requestId);
      return;
    }
    if (!hostGesture && !navigator.userActivation?.isActive) {
      this.pendingRequestId = requestId;
      this.emitStatus('needs-permission');
      this.needsHostGesture();
      return;
    }
    this.pendingRequestId = undefined;
    this.emitStatus('requesting');
    // Deliberately invoke this immediately in the message event task. Waiting first loses
    // Safari's transient user activation when the request originated from an iframe click.
    void requestPermission.call(Orientation).then((result) => {
      if (result !== 'granted') return this.emitStatus('denied', requestId);
      this.startListening();
      this.emitStatus('no-data', requestId);
    }).catch(() => this.emitStatus('denied', requestId));
  }

  requestFromHostGesture(): void {
    this.request(this.pendingRequestId, true);
  }

  private detectInitialStatus(): OrientationStatus {
    if (this.sensors.length === 0) return 'unsupported';
    if (!window.isSecureContext) return 'blocked-by-policy';
    if (!('DeviceOrientationEvent' in window)) return 'unsupported';
    const policy = document as Document & {
      permissionsPolicy?: { allowsFeature(feature: string): boolean };
      featurePolicy?: { allowsFeature(feature: string): boolean };
    };
    const permissions = policy.permissionsPolicy ?? policy.featurePolicy;
    if (permissions && this.sensors.some((sensor) => !permissions.allowsFeature(sensor))) return 'blocked-by-policy';
    return 'needs-permission';
  }

  private startListening(): void {
    if (!this.listening) {
      window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
      document.addEventListener('visibilitychange', this.onVisibility);
      this.listening = true;
    }
    this.armNoDataTimer();
  }

  private onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.beta == null || event.gamma == null || document.hidden) return;
    if (this.noDataTimer) clearTimeout(this.noDataTimer);
    this.emitStatus('active');
    const orientation = screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
    const data: OrientationData = {
      beta: event.beta,
      gamma: event.gamma,
      screenAngle: orientation,
      timestamp: performance.timeOrigin + event.timeStamp,
    };
    this.emit({ __parti: true, type: 'orientation-data', data });
    this.armNoDataTimer();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      if (this.noDataTimer) clearTimeout(this.noDataTimer);
      this.emitStatus('no-data');
    } else {
      this.armNoDataTimer();
    }
  };

  private armNoDataTimer(): void {
    if (this.noDataTimer) clearTimeout(this.noDataTimer);
    this.noDataTimer = setTimeout(() => this.emitStatus('no-data'), 1500);
  }

  private emitStatus(status: OrientationStatus, requestId?: number): void {
    const changed = status !== this.status;
    this.status = status;
    if (changed) this.onStatusChange?.(status);
    if (changed || requestId !== undefined) {
      this.emit({ __parti: true, type: 'orientation-status', status, ...(requestId === undefined ? {} : { requestId }) });
    }
  }

  dispose(): void {
    if (this.noDataTimer) clearTimeout(this.noDataTimer);
    if (this.listening) {
      window.removeEventListener('deviceorientation', this.onOrientation);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }
}

/** Runtime 暴露给 UI 的统一端口 */
export interface RoomClientPort {
  isReady(): boolean;
  onReady(cb: () => void): () => void;
  getPlayerId(): string;
  getState(): unknown;
  submitAction(action: string, payload: unknown): void;
  ready(): void;
  leave(): void;
  onState(cb: (state: unknown) => void): () => void;
  onEvent(cb: (event: string, payload: unknown) => void): () => void;
}

export interface UISandboxBridgeOptions {
  onLog?: (args: unknown[]) => void;
  orientationSensors?: readonly string[];
  onOrientationStatusChange?: (status: OrientationStatus) => void;
  /** iframe 的点击无法把 transient activation 传给 Safari 时，请宿主显示真实按钮。 */
  onOrientationHostGestureRequired?: () => void;
  /**
   * 本客户端是否供 AI agent 游玩。为 true 时随 init 通知 iframe 进入 agent 模式，
   * 房间的 parti.exposeToAgent 转述函数才会被调用。
   */
  agent?: boolean;
  /** 收到房间转述的 agent guide 时回调，宿主页据此暴露给 window.__partiAgent。 */
  onAgentGuide?: (guide: unknown) => void;
}

export class UISandboxBridge {
  private readonly iframe: HTMLIFrameElement;
  private readonly port: RoomClientPort;
  private readonly opts: UISandboxBridgeOptions;
  private readonly unsubscribers: Array<() => void> = [];
  private helloSeen = false;
  private initSent = false;
  private readonly messageListener: (e: MessageEvent) => void;
  private readonly orientation: HostOrientationController;

  constructor(
    iframe: HTMLIFrameElement,
    port: RoomClientPort,
    opts: UISandboxBridgeOptions = {},
  ) {
    this.iframe = iframe;
    this.port = port;
    this.opts = opts;
    this.orientation = new HostOrientationController(
      (msg) => this.post(msg),
      () => this.opts.onOrientationHostGestureRequired?.(),
      this.opts.orientationSensors ?? [],
      this.opts.onOrientationStatusChange,
    );

    this.messageListener = (e: MessageEvent) => this.onMessage(e);
    window.addEventListener('message', this.messageListener);

    this.unsubscribers.push(
      // init 之前的 state 不得转发：iframe 侧收到 state 会立即触发 onState，
      // 而 playerId 要随 init 才就绪（docs/client-api.md 契约）。init 消息本身
      // 携带 port.getState() 的最新状态，丢弃 init 前的转发不会丢状态。
      port.onState((state) => {
        if (!this.initSent) return;
        this.post({ __parti: true, type: 'state', state });
      }),
      port.onEvent((event, payload) =>
        this.post({ __parti: true, type: 'event', event, payload }),
      ),
      port.onReady(() => this.tryInit()),
    );
  }

  private onMessage(e: MessageEvent): void {
    if (e.source !== this.iframe.contentWindow) return;
    const msg = e.data as UiToHost;
    if (!msg || (msg as { __parti?: boolean }).__parti !== true) return;

    switch (msg.type) {
      case 'hello':
        this.helloSeen = true;
        this.tryInit();
        break;
      case 'action':
        this.port.submitAction(msg.action, msg.payload);
        break;
      case 'ready':
        this.port.ready();
        break;
      case 'leave':
        this.port.leave();
        break;
      case 'orientation-request':
        this.orientation.request(msg.requestId);
        break;
      case 'log':
        this.opts.onLog?.(msg.args);
        break;
      case 'agent-guide':
        this.opts.onAgentGuide?.(msg.guide);
        break;
    }
  }

  private tryInit(): void {
    if (this.initSent || !this.helloSeen || !this.port.isReady()) return;
    this.initSent = true;
    this.post({
      __parti: true,
      type: 'init',
      playerId: this.port.getPlayerId(),
      state: this.port.getState(),
      ...(this.opts.agent ? { agent: true } : {}),
    });
    this.orientation.announce();
  }

  private post(msg: HostToUi): void {
    this.iframe.contentWindow?.postMessage(msg, '*');
  }

  /** 必须由顶层页面的 click/pointer handler 同步调用。 */
  requestOrientationPermission(): void {
    this.orientation.requestFromHostGesture();
  }

  dispose(): void {
    window.removeEventListener('message', this.messageListener);
    for (const off of this.unsubscribers) off();
    this.orientation.dispose();
  }
}

/** 向完整 HTML 或旧式 fragment 注入 Client SDK，供 URL loader 使用。 */
export function buildRoomDocument(roomHtml: string): string {
  const injected = `<meta name="viewport" content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover"><script>${CLIENT_SDK_SCRIPT}</script>`;
  if (/<html[\s>]/i.test(roomHtml)) {
    if (/<head[\s>]/i.test(roomHtml)) return roomHtml.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
    return roomHtml.replace(/<html([^>]*)>/i, `<html$1><head>${injected}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${injected}</head><body>${roomHtml}</body></html>`;
}

// --- 端口适配器 ---

/** host 自身的本地玩家端口（不经 transport）。 */
export function createHostLocalPort(host: HostRuntime): RoomClientPort {
  return {
    isReady: () => true,
    onReady: (cb) => {
      cb();
      return () => {};
    },
    getPlayerId: () => host.getHostPlayerId(),
    getState: () => host.currentSnapshot().state,
    submitAction: (action, payload) => host.submitLocalAction(action, payload),
    ready: () => host.localReady(),
    leave: () => {},
    onState: (cb) => host.localState.on((s) => cb(s.state)),
    onEvent: (cb) => host.localEvent.on((e) => cb(e.event, e.payload)),
  };
}

/** 远端玩家端口，包装 ClientRuntime。 */
export function createClientPort(client: ClientRuntime): RoomClientPort {
  let welcomed = false;
  let hasState = false;
  const readyCbs = new Set<() => void>();

  const fireReady = () => {
    if (welcomed && hasState) for (const cb of [...readyCbs]) cb();
  };

  client.welcome.on(() => {
    welcomed = true;
    fireReady();
  });
  client.stateChanged.on(() => {
    hasState = true;
    fireReady();
  });

  return {
    isReady: () => welcomed && hasState,
    onReady: (cb) => {
      readyCbs.add(cb);
      if (welcomed && hasState) cb();
      return () => readyCbs.delete(cb);
    },
    getPlayerId: () => client.getPlayerId(),
    getState: () => client.getState(),
    submitAction: (action, payload) => client.submitAction(action, payload),
    ready: () => client.ready(),
    leave: () => client.leave(),
    onState: (cb) => client.stateChanged.on((s) => cb(s.state)),
    onEvent: (cb) => client.event.on((e) => cb(e.event, e.payload)),
  };
}
