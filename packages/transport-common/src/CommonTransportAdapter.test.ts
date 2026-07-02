import { describe, expect, it, vi } from 'vitest';
import { CommonTransportAdapter, type CommonProviderConnection, type CommonProviderMessage, type CommonTransportProvider } from './CommonTransportAdapter';

class MemoryProvider implements CommonTransportProvider {
  private topics = new Map<string, Map<string, Parameters<CommonTransportProvider['connect']>[0]>>();
  async connect(options: Parameters<CommonTransportProvider['connect']>[0]): Promise<CommonProviderConnection> {
    const topic = this.topics.get(options.topic) ?? new Map();
    this.topics.set(options.topic, topic);
    for (const peer of topic.values()) { peer.onJoin(options.selfId); options.onJoin(peer.selfId); }
    topic.set(options.selfId, options);
    return {
      send: (payload: CommonProviderMessage) => { for (const peer of topic.values()) peer.onMessage(payload); },
      close: () => { if (!topic.delete(options.selfId)) return; for (const peer of topic.values()) peer.onLeave(options.selfId); },
    };
  }
}

describe('CommonTransportAdapter', () => {
  it('connects, sends directed messages, broadcasts with exclusions, and disconnects', async () => {
    const provider = new MemoryProvider();
    const host = await new CommonTransportAdapter(provider).createHost({ roomId: 'room', hostId: 'host' });
    const connections: string[] = [];
    host.onConnection((peer) => connections.push(peer.id));
    const a = await new CommonTransportAdapter(provider).joinRoom({ roomId: 'room', hostConnectionInfo: host.connectionInfo, selfId: 'a' });
    const b = await new CommonTransportAdapter(provider).joinRoom({ roomId: 'room', hostConnectionInfo: host.connectionInfo, selfId: 'b' });
    expect(connections).toEqual(['a', 'b']);

    const fromClient = vi.fn(); host.onMessage(fromClient);
    a.send({ data: { hello: 'host' } });
    expect(fromClient).toHaveBeenCalledWith('a', expect.objectContaining({ data: { hello: 'host' } }));

    const toA = vi.fn(); const toB = vi.fn(); a.onMessage(toA); b.onMessage(toB);
    host.broadcast({ data: 'all-but-b' }, { except: ['b'] });
    expect(toA).toHaveBeenCalledWith(expect.objectContaining({ data: 'all-but-b' }));
    expect(toB).not.toHaveBeenCalled();

    const disconnected = vi.fn(); host.onDisconnect(disconnected); a.close();
    expect(disconnected).toHaveBeenCalledWith('a', 'closed');
    b.close(); host.close();
  });

  it('rejects malformed connection information', async () => {
    await expect(new CommonTransportAdapter(new MemoryProvider()).joinRoom({
      roomId: 'room', hostConnectionInfo: 'not-valid!',
    })).rejects.toThrow('Invalid common connection info');
  });

  it('creates identifiers without crypto.randomUUID', async () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const host = await new CommonTransportAdapter(new MemoryProvider()).createHost({ roomId: 'room' });
      expect(host.selfId).toMatch(/^[0-9a-f]{32}$/);
      host.close();
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
