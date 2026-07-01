import type { TransportAdapter } from '@parti/core';
import { CommonTransportAdapter, SupabaseRealtimeProvider } from '@parti/transport-common';
import { PeerJSTransportAdapter } from '@parti/transport-peerjs';

export type TransportConfig =
  | { adapter: 'peerjs' }
  | { adapter: 'common'; provider: 'supabase'; url: string; publishableKey: string };

export type TransportPreference = 'peerjs' | 'common';
const PREFERENCE_KEY = 'parti:transport-preference';

export function isCommonTransportConfigured(): boolean {
  const url = import.meta.env.VITE_COMMON_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_COMMON_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return false;
  try {
    validateTransportConfig({ adapter: 'common', provider: 'supabase', url, publishableKey });
    return true;
  } catch {
    return false;
  }
}

export function loadTransportPreference(): TransportPreference {
  return localStorage.getItem(PREFERENCE_KEY) === 'common' && isCommonTransportConfigured()
    ? 'common'
    : 'peerjs';
}

export function saveTransportPreference(value: TransportPreference): void {
  localStorage.setItem(PREFERENCE_KEY, value === 'common' && !isCommonTransportConfigured() ? 'peerjs' : value);
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isSecretKey(key: string): boolean {
  if (/^(sb_secret_|service_role)/i.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1]!.replaceAll('-', '+').replaceAll('_', '/'))) as { role?: string };
    return payload.role === 'service_role';
  } catch { return false; }
}

export function validateTransportConfig(config: TransportConfig): TransportConfig {
  if (config.adapter === 'peerjs') return config;
  if (config.provider !== 'supabase') throw new Error('Unsupported common transport provider');
  if (config.url.length > 512 || config.publishableKey.length > 2048 || !config.publishableKey) throw new Error('Invalid Supabase transport configuration');
  const url = new URL(config.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) throw new Error('Supabase transport URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash || isSecretKey(config.publishableKey)) throw new Error('Unsafe Supabase transport configuration');
  return { ...config, url: url.toString().replace(/\/$/, '') };
}

export function configuredTransport(preference = loadTransportPreference()): TransportConfig {
  if (preference === 'peerjs') return { adapter: 'peerjs' };
  const url = import.meta.env.VITE_COMMON_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_COMMON_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) throw new Error('Common (Supabase) transport is not configured');
  return validateTransportConfig({ adapter: 'common', provider: 'supabase', url, publishableKey });
}

export function createTransportAdapter(config: TransportConfig): TransportAdapter {
  const valid = validateTransportConfig(config);
  if (valid.adapter === 'peerjs') return new PeerJSTransportAdapter();
  return new CommonTransportAdapter(new SupabaseRealtimeProvider({ url: valid.url, publishableKey: valid.publishableKey }));
}
