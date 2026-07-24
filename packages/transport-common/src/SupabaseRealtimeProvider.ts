import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { CommonProviderConnection, CommonProviderMessage, CommonTransportProvider } from './CommonTransportAdapter';
import { encodeSupabaseMessage, SupabaseMessageReassembler } from './SupabaseMessageFraming';

export interface SupabaseRealtimeProviderOptions { url: string; publishableKey: string }

export class SupabaseRealtimeProvider implements CommonTransportProvider {
  constructor(private readonly options: SupabaseRealtimeProviderOptions) {}

  async connect(options: Parameters<CommonTransportProvider['connect']>[0]): Promise<CommonProviderConnection> {
    const client = createClient(this.options.url, this.options.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const channel: RealtimeChannel = client.channel(options.topic, {
      config: { broadcast: { ack: true, self: false }, presence: { key: options.selfId } },
    });
    const present = new Set<string>();
    const reassembler = new SupabaseMessageReassembler(options.onError);
    channel
      .on('broadcast', { event: 'parti-message' }, ({ payload }) => {
        try {
          const message = reassembler.accept(payload);
          if (message) options.onMessage(message);
        } catch (error) {
          options.onError(`Supabase receive failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const next = new Set(Object.keys(channel.presenceState()));
        for (const peerId of next) if (!present.has(peerId)) options.onJoin(peerId);
        for (const peerId of present) if (!next.has(peerId)) options.onLeave(peerId);
        present.clear();
        for (const peerId of next) present.add(peerId);
      });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Supabase Realtime connection timed out')), 10_000);
      channel.subscribe(async (status, error) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          const result = await channel.track({ online_at: new Date().toISOString() });
          if (result === 'ok') resolve(); else reject(new Error(`Supabase Presence failed: ${result}`));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          const reason = error?.message ?? status;
          options.onError(reason);
          reject(new Error(reason));
        } else if (status === 'CLOSED') options.onError('closed');
      });
    });
    let closed = false;
    let sendQueue = Promise.resolve();
    return {
      send: (payload: CommonProviderMessage) => {
        const operation = sendQueue.then(async () => {
          if (closed) return;
          const frames = encodeSupabaseMessage(payload);
          for (const frame of frames) {
            const result = await channel.send({
              type: 'broadcast',
              event: 'parti-message',
              payload: frame.payload,
            });
            if (result !== 'ok') {
              const stage = frame.chunkTotal === undefined
                ? 'direct'
                : `chunk ${frame.chunkIndex! + 1}/${frame.chunkTotal}`;
              throw new Error(`${stage}, messageBytes=${frame.encodedBytes}, result=${result}`);
            }
          }
        });
        sendQueue = operation.catch((error) => {
          options.onError(`Supabase send failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      },
      close: () => {
        if (closed) return;
        closed = true;
        reassembler.clear();
        void channel.untrack();
        void client.removeChannel(channel);
      },
    };
  }
}
