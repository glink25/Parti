/**
 * PeerJSTransportAdapter (GOAL.md §7.3) —— 用 PeerJS / WebRTC 承载 RoomMessage。
 *
 * 适合 MVP：减少服务端负担（仅用公共 PeerServer 做信令）。host 的 peer id 即邀请码。
 * PeerJS 细节（DataConnection 等）不暴露给创作者，只实现统一 Transport 接口。
 */
import Peer, { type DataConnection } from 'peerjs';
import type {
  ClientTransportSession,
  CreateHostOptions,
  HostTransportSession,
  JoinRoomOptions,
  PeerId,
  TransportAdapter,
  TransportMessage,
  TransportPeer,
} from '@parti/core';

export interface PeerJSAdapterOptions {
  /** 透传给 PeerJS Peer 的配置（如自建 PeerServer host/port）。 */
  peerOptions?: Record<string, unknown>;
}

function waitForOpen(peer: Peer): Promise<string> {
  return new Promise((resolve, reject) => {
    peer.on('open', (id) => resolve(id));
    peer.on('error', (err) => reject(err));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 用稳定 hostId 创建 host peer，处理「刷新瞬间旧 peer 未释放」导致的
 * unavailable-id：退避重试若干次；仍失败则回退到随机 id（邀请链接随之更新）。
 * 这是房主刷新后复用邀请码的关键 (GOAL §17 Phase 4)。
 */
async function openHostPeer(
  requestedId: string | undefined,
  peerOptions: Record<string, unknown> | undefined,
  retries = 3,
): Promise<Peer> {
  let id = requestedId;
  for (let attempt = 0; ; attempt += 1) {
    const peer = id ? new Peer(id, peerOptions) : new Peer(peerOptions ?? {});
    try {
      await waitForOpen(peer);
      return peer;
    } catch (err) {
      peer.destroy();
      const type = (err as { type?: string } | undefined)?.type;
      if (id && type === 'unavailable-id') {
        if (attempt < retries) {
          await delay(300 * 2 ** attempt);
          continue;
        }
        // 重试耗尽：放弃稳定 id，回退随机 id。
        id = undefined;
        continue;
      }
      throw err;
    }
  }
}

export class PeerJSTransportAdapter implements TransportAdapter {
  readonly name = 'peerjs';
  private readonly opts: PeerJSAdapterOptions;

  constructor(opts: PeerJSAdapterOptions = {}) {
    this.opts = opts;
  }

  async createHost(options: CreateHostOptions): Promise<HostTransportSession> {
    const peer = await openHostPeer(options.hostId, this.opts.peerOptions);
    const selfId = peer.id;

    const conns = new Map<PeerId, DataConnection>();
    let connectionHandler: ((peer: TransportPeer) => void) | undefined;
    let messageHandler:
      | ((peerId: PeerId, message: TransportMessage) => void)
      | undefined;
    let disconnectHandler:
      | ((peerId: PeerId, reason?: string) => void)
      | undefined;

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conns.set(conn.peer, conn);
        connectionHandler?.({ id: conn.peer });
      });
      conn.on('data', (data) => {
        messageHandler?.(conn.peer, toTransportMessage(data));
      });
      conn.on('close', () => {
        conns.delete(conn.peer);
        disconnectHandler?.(conn.peer, 'closed');
      });
      conn.on('error', () => {
        conns.delete(conn.peer);
        disconnectHandler?.(conn.peer, 'error');
      });
    });

    return {
      selfId,
      connectionInfo: selfId,
      send: (peerId, message) => conns.get(peerId)?.send(message.data),
      broadcast: (message, opts) => {
        const except = opts?.except ?? [];
        for (const [peerId, conn] of conns) {
          if (except.includes(peerId)) continue;
          conn.send(message.data);
        }
      },
      onConnection: (handler) => {
        connectionHandler = handler;
      },
      onMessage: (handler) => {
        messageHandler = handler;
      },
      onDisconnect: (handler) => {
        disconnectHandler = handler;
      },
      close: () => {
        for (const conn of conns.values()) conn.close();
        conns.clear();
        peer.destroy();
      },
    };
  }

  async joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession> {
    const peer = options.selfId
      ? new Peer(options.selfId, this.opts.peerOptions)
      : new Peer(this.opts.peerOptions ?? {});
    const selfId = await waitForOpen(peer);

    const conn = peer.connect(options.hostConnectionInfo, { reliable: true });
    await new Promise<void>((resolve, reject) => {
      conn.on('open', () => resolve());
      conn.on('error', (err) => reject(err));
      peer.on('error', (err) => reject(err));
    });

    let messageHandler: ((message: TransportMessage) => void) | undefined;
    let disconnectHandler: ((reason?: string) => void) | undefined;

    conn.on('data', (data) => messageHandler?.(toTransportMessage(data)));
    conn.on('close', () => disconnectHandler?.('closed'));
    conn.on('error', () => disconnectHandler?.('error'));

    return {
      selfId,
      hostId: options.hostConnectionInfo,
      send: (message) => conn.send(message.data),
      onMessage: (handler) => {
        messageHandler = handler;
      },
      onDisconnect: (handler) => {
        disconnectHandler = handler;
      },
      close: () => {
        conn.close();
        peer.destroy();
      },
    };
  }
}

function toTransportMessage(data: unknown): TransportMessage {
  // PeerJS 已完成（反）序列化，data 即原始 RoomMessage 对象。
  return { data: data as object, meta: { reliable: true, ordered: true } };
}
