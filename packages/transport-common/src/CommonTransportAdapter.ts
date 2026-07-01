import type {
  ClientTransportSession, CreateHostOptions, HostTransportSession, JoinRoomOptions,
  PeerId, TransportAdapter, TransportMessage,
} from '@parti/core';
import { v4 as uuidv4 } from 'uuid';

export interface CommonProviderMessage {
  sender: string;
  target?: string;
  message: TransportMessage;
}

export interface CommonProviderConnection {
  send(payload: CommonProviderMessage): void;
  close(): void;
}

export interface CommonTransportProvider {
  connect(options: {
    topic: string;
    selfId: string;
    onMessage(payload: CommonProviderMessage): void;
    onJoin(peerId: string): void;
    onLeave(peerId: string): void;
    onError(reason: string): void;
  }): Promise<CommonProviderConnection>;
}

interface ConnectionInfo { topic: string; hostId: string }

function randomId(): string {
  return uuidv4().replaceAll('-', '');
}

function encodeInfo(value: ConnectionInfo): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeInfo(value: string): ConnectionInfo {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid common connection info');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as Partial<ConnectionInfo>;
  if (!parsed.topic || !parsed.hostId || parsed.topic.length > 128 || parsed.hostId.length > 128) {
    throw new Error('Invalid common connection info');
  }
  return parsed as ConnectionInfo;
}

export class CommonTransportAdapter implements TransportAdapter {
  readonly name = 'common';
  constructor(private readonly provider: CommonTransportProvider) {}

  async createHost(options: CreateHostOptions): Promise<HostTransportSession> {
    const selfId = options.hostId ?? randomId();
    // hostId 本身是高熵且会被 HostRuntime 持久化；由它派生 topic 可保持刷新后邀请链接稳定。
    const info = { topic: `parti-${selfId}`, hostId: selfId };
    let connectionHandler: ((peer: { id: PeerId }) => void) | undefined;
    let messageHandler: ((peerId: PeerId, message: TransportMessage) => void) | undefined;
    let disconnectHandler: ((peerId: PeerId, reason?: string) => void) | undefined;
    const peers = new Set<string>();
    const connection = await this.provider.connect({
      topic: info.topic,
      selfId,
      onMessage: (payload) => {
        if (payload.sender !== selfId && (!payload.target || payload.target === selfId)) {
          messageHandler?.(payload.sender, payload.message);
        }
      },
      onJoin: (peerId) => {
        if (peerId === selfId || peers.has(peerId)) return;
        peers.add(peerId);
        connectionHandler?.({ id: peerId });
      },
      onLeave: (peerId) => {
        if (!peers.delete(peerId)) return;
        disconnectHandler?.(peerId, 'closed');
      },
      onError: (reason) => {
        for (const peerId of peers) disconnectHandler?.(peerId, reason);
        peers.clear();
      },
    });
    return {
      selfId,
      connectionInfo: encodeInfo(info),
      send: (peerId, message) => connection.send({ sender: selfId, target: peerId, message }),
      broadcast: (message, config) => {
        const except = new Set(config?.except ?? []);
        for (const peerId of peers) if (!except.has(peerId)) connection.send({ sender: selfId, target: peerId, message });
      },
      onConnection: (handler) => { connectionHandler = handler; },
      onMessage: (handler) => { messageHandler = handler; },
      onDisconnect: (handler) => { disconnectHandler = handler; },
      close: () => connection.close(),
    };
  }

  async joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession> {
    const info = decodeInfo(options.hostConnectionInfo);
    const selfId = options.selfId ?? randomId();
    let messageHandler: ((message: TransportMessage) => void) | undefined;
    let disconnectHandler: ((reason?: string) => void) | undefined;
    const connection = await this.provider.connect({
      topic: info.topic,
      selfId,
      onMessage: (payload) => {
        if (payload.sender === info.hostId && (!payload.target || payload.target === selfId)) messageHandler?.(payload.message);
      },
      onJoin: () => {},
      onLeave: (peerId) => { if (peerId === info.hostId) disconnectHandler?.('closed'); },
      onError: (reason) => disconnectHandler?.(reason),
    });
    return {
      selfId,
      hostId: info.hostId,
      send: (message) => connection.send({ sender: selfId, target: info.hostId, message }),
      onMessage: (handler) => { messageHandler = handler; },
      onDisconnect: (handler) => { disconnectHandler = handler; },
      close: () => connection.close(),
    };
  }
}
