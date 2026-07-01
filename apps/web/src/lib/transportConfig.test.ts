import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PEERJS_ID, BUILTIN_SUPABASE_ID, deleteCustomTransportProfile,
  createTransportAdapter, getSelectedTransportProfile, getTransportProfiles, peerOptionsFromServerUrl,
  saveCustomTransportProfile, selectTransportProfile, validateTransportConfig,
} from './transportConfig.js';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('transport profiles', () => {
  it('offers built-ins according to deployment configuration', () => {
    const storage = new MemoryStorage();
    expect(getTransportProfiles(storage, {}).map((profile) => profile.id)).toEqual([BUILTIN_PEERJS_ID]);
    expect(getTransportProfiles(storage, {
      supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'sb_publishable_public',
    }).map((profile) => profile.id)).toEqual([BUILTIN_PEERJS_ID, BUILTIN_SUPABASE_ID]);
  });

  it('creates, edits, selects and deletes custom profiles', () => {
    const storage = new MemoryStorage();
    const created = saveCustomTransportProfile({
      name: ' My Peer ', config: { adapter: 'peerjs', serverUrl: 'https://peer.example.com/peerjs/' },
    }, undefined, storage);
    expect(created.name).toBe('My Peer');
    expect(getSelectedTransportProfile(storage, {}).id).toBe(created.id);
    saveCustomTransportProfile({
      name: 'My Supabase', config: { adapter: 'common', provider: 'supabase', url: 'https://project.supabase.co', publishableKey: 'anon-key' },
    }, created.id, storage);
    expect(selectTransportProfile(created.id, storage, {}).config.adapter).toBe('common');
    deleteCustomTransportProfile(created.id, storage);
    expect(getSelectedTransportProfile(storage, {}).id).toBe(BUILTIN_PEERJS_ID);
  });

  it('migrates legacy preference and falls back when Supabase is unavailable', () => {
    const storage = new MemoryStorage();
    storage.setItem('parti:transport-preference', 'common');
    expect(getSelectedTransportProfile(storage, {}).id).toBe(BUILTIN_PEERJS_ID);
  });

  it('parses PeerServer URL and rejects unsafe services', () => {
    expect(peerOptionsFromServerUrl('https://peer.example.com:9443/peerjs/')).toEqual({
      host: 'peer.example.com', port: 9443, path: '/peerjs', secure: true,
    });
    expect(() => validateTransportConfig({ adapter: 'peerjs', serverUrl: 'http://evil.test' })).toThrow();
    const adapter = createTransportAdapter({ adapter: 'peerjs', serverUrl: 'https://peer.example.com:9443/peerjs' });
    expect((adapter as unknown as { opts: { peerOptions: unknown } }).opts.peerOptions).toEqual({
      host: 'peer.example.com', port: 9443, path: '/peerjs', secure: true,
    });
    expect(() => validateTransportConfig({
      adapter: 'common', provider: 'supabase', url: 'https://project.supabase.co', publishableKey: 'sb_secret_nope',
    })).toThrow();
  });
});
