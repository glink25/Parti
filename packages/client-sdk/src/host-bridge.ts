/**
 * 宿主页侧的 UI 沙箱桥 (GOAL.md §10.3)。
 *
 * UISandboxBridge 把一个 sandbox iframe 的 postMessage 通道连接到一个
 * RoomClientPort —— 后者抽象了「host 自己的本地玩家」与「远端 ClientRuntime」，
 * 因此同一段 Room UI 代码在 host 与 player 端运行完全一致。
 */
import type { HostRuntime, ClientRuntime } from '@parti/core';
import { CLIENT_SDK_SCRIPT } from './bootstrap.js';
import type { HostToUi, UiToHost } from './protocol.js';

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
}

export class UISandboxBridge {
  private readonly iframe: HTMLIFrameElement;
  private readonly port: RoomClientPort;
  private readonly opts: UISandboxBridgeOptions;
  private readonly unsubscribers: Array<() => void> = [];
  private helloSeen = false;
  private initSent = false;
  private readonly messageListener: (e: MessageEvent) => void;

  constructor(
    iframe: HTMLIFrameElement,
    port: RoomClientPort,
    opts: UISandboxBridgeOptions = {},
  ) {
    this.iframe = iframe;
    this.port = port;
    this.opts = opts;

    this.messageListener = (e: MessageEvent) => this.onMessage(e);
    window.addEventListener('message', this.messageListener);

    this.unsubscribers.push(
      port.onState((state) => this.post({ __parti: true, type: 'state', state })),
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
      case 'log':
        this.opts.onLog?.(msg.args);
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
    });
  }

  private post(msg: HostToUi): void {
    this.iframe.contentWindow?.postMessage(msg, '*');
  }

  dispose(): void {
    window.removeEventListener('message', this.messageListener);
    for (const off of this.unsubscribers) off();
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
