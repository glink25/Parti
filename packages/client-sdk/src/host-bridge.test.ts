/**
 * UISandboxBridge 时序回归测试（node 环境，最小 DOM fake）。
 *
 * 契约（docs/client-api.md）：iframe 内首次 onState 回调时 parti.playerId 必须已就绪。
 * 回归场景：远端玩家的 welcome/snapshot 走网络，iframe 的 hello 先到——
 * init 发出之前的任何 port 状态变更都不得转发为 'state' 消息。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UISandboxBridge, type RoomClientPort } from './host-bridge';

type MessageListener = (e: { source: unknown; data: unknown }) => void;

function createFakePort(initialState: unknown = { v: 0 }) {
  let ready = false;
  const stateCbs = new Set<(s: unknown) => void>();
  const readyCbs = new Set<() => void>();
  const port: RoomClientPort = {
    isReady: () => ready,
    onReady: (cb) => {
      readyCbs.add(cb);
      if (ready) cb();
      return () => readyCbs.delete(cb);
    },
    getPlayerId: () => 'player-1',
    getState: () => initialState,
    submitAction: () => {},
    ready: () => {},
    leave: () => {},
    onState: (cb) => {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    onEvent: () => () => {},
  };
  return {
    port,
    emitState(state: unknown) {
      for (const cb of [...stateCbs]) cb(state);
    },
    setReady() {
      ready = true;
      for (const cb of [...readyCbs]) cb();
    },
  };
}

describe('UISandboxBridge state 转发门控', () => {
  let messageListener: MessageListener | undefined;
  let bridge: UISandboxBridge | undefined;
  let postMessage: ReturnType<typeof vi.fn>;
  let iframe: { contentWindow: { postMessage: ReturnType<typeof vi.fn> } };
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, cb: MessageListener) => {
        if (type === 'message') messageListener = cb;
      },
      removeEventListener: () => {},
    };
    postMessage = vi.fn();
    iframe = { contentWindow: { postMessage } };
  });

  afterEach(() => {
    bridge?.dispose();
    bridge = undefined;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  const posted = () =>
    postMessage.mock.calls.map(([msg]) => msg as { type: string });
  const hello = () =>
    messageListener?.({
      source: iframe.contentWindow,
      data: { __parti: true, type: 'hello' },
    });

  it('init 之前不转发 state，init 之后才转发', () => {
    const { port, emitState, setReady } = createFakePort({ v: 0 });
    bridge = new UISandboxBridge(iframe as never, port);

    // 1. hello 之前 port 触发 state：不得转发
    emitState({ v: 1 });
    expect(posted()).toEqual([]);

    // 2. hello 已到但 port 未 ready（welcome/snapshot 未到达）：仍不得转发
    hello();
    emitState({ v: 2 });
    expect(posted()).toEqual([]);

    // 3. port ready 后发出 init，携带 playerId 与最新 state
    setReady();
    const types = posted().map((m) => m.type);
    expect(types[0]).toBe('init');
    const init = postMessage.mock.calls[0][0] as {
      type: string;
      playerId: string;
      state: unknown;
    };
    expect(init.playerId).toBe('player-1');
    expect(init.state).toEqual({ v: 0 });

    // 4. init 之后的 state 正常转发
    emitState({ v: 3 });
    expect(posted().map((m) => m.type)).toContain('state');
    expect(posted().find((m) => m.type === 'state')).toEqual({
      __parti: true,
      type: 'state',
      state: { v: 3 },
    });
  });
});
