import type { TransportAdapter } from '@parti/core';
import { CommonTransportAdapter, SupabaseRealtimeProvider } from '@parti/transport-common';
import { PeerJSTransportAdapter } from '@parti/transport-peerjs';
import { createUuid } from './ids.js';

export type TransportConfig =
  | { adapter: 'peerjs'; serverUrl?: string }
  | { adapter: 'common'; provider: 'supabase'; url: string; publishableKey: string };

export interface TransportProfile {
  id: string;
  name: string;
  config: TransportConfig;
  custom: boolean;
}

export type CustomTransportProfileInput = Pick<TransportProfile, 'name' | 'config'>;
export const BUILTIN_PEERJS_ID = 'builtin:peerjs';
export const BUILTIN_SUPABASE_ID = 'builtin:supabase';
export const MAX_TRANSPORT_PROFILE_NAME_LENGTH = 50;
const PROFILES_KEY = 'parti:transport-profiles:v1';
const SELECTED_KEY = 'parti:transport-profile:selected:v1';
const LEGACY_PREFERENCE_KEY = 'parti:transport-preference';

interface TransportEnvironment { supabaseUrl?: string; supabasePublishableKey?: string }

function environment(): TransportEnvironment {
  return {
    supabaseUrl: import.meta.env.VITE_COMMON_SUPABASE_URL?.trim(),
    supabasePublishableKey: import.meta.env.VITE_COMMON_SUPABASE_PUBLISHABLE_KEY?.trim(),
  };
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateServiceUrl(value: string, label: string): string {
  if (!value || value.length > 512) throw new Error(`${label} is invalid`);
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new Error(`${label} must use HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} is unsafe`);
  return url.toString().replace(/\/$/, '');
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
  if (config.adapter === 'peerjs') {
    return config.serverUrl
      ? { adapter: 'peerjs', serverUrl: validateServiceUrl(config.serverUrl, 'PeerServer URL') }
      : { adapter: 'peerjs' };
  }
  if (config.provider !== 'supabase') throw new Error('Unsupported common transport provider');
  if (!config.publishableKey || config.publishableKey.length > 2048) throw new Error('Invalid Supabase transport configuration');
  if (isSecretKey(config.publishableKey)) throw new Error('Unsafe Supabase transport configuration');
  return {
    adapter: 'common', provider: 'supabase',
    url: validateServiceUrl(config.url, 'Supabase URL'), publishableKey: config.publishableKey,
  };
}

export function peerOptionsFromServerUrl(serverUrl: string): Record<string, unknown> {
  const normalized = validateServiceUrl(serverUrl, 'PeerServer URL');
  const url = new URL(normalized);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    path: url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, ''),
    secure: url.protocol === 'https:',
  };
}

function builtInProfiles(env: TransportEnvironment): TransportProfile[] {
  const profiles: TransportProfile[] = [
    { id: BUILTIN_PEERJS_ID, name: 'PeerJS / WebRTC', config: { adapter: 'peerjs' }, custom: false },
  ];
  if (env.supabaseUrl && env.supabasePublishableKey) {
    try {
      profiles.push({
        id: BUILTIN_SUPABASE_ID,
        name: 'Common / Supabase Realtime',
        config: validateTransportConfig({
          adapter: 'common', provider: 'supabase', url: env.supabaseUrl,
          publishableKey: env.supabasePublishableKey,
        }),
        custom: false,
      });
    } catch { /* Invalid deployment configuration is not offered. */ }
  }
  return profiles;
}

function loadCustomProfiles(storage: Storage): TransportProfile[] {
  try {
    const parsed = JSON.parse(storage.getItem(PROFILES_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): TransportProfile[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Partial<TransportProfile>;
      if (typeof value.id !== 'string' || typeof value.name !== 'string' || !value.config) return [];
      try {
        const name = validateProfileName(value.name);
        return [{ id: value.id, name, config: validateTransportConfig(value.config), custom: true }];
      } catch { return []; }
    });
  } catch { return []; }
}

function saveCustomProfiles(storage: Storage, profiles: TransportProfile[]): void {
  storage.setItem(PROFILES_KEY, JSON.stringify(profiles.filter((profile) => profile.custom)));
}

export function validateProfileName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > MAX_TRANSPORT_PROFILE_NAME_LENGTH) {
    throw new Error(`Profile name must be 1-${MAX_TRANSPORT_PROFILE_NAME_LENGTH} characters`);
  }
  return normalized;
}

export function getTransportProfiles(storage: Storage = localStorage, env = environment()): TransportProfile[] {
  return [...builtInProfiles(env), ...loadCustomProfiles(storage)];
}

export function getSelectedTransportProfile(storage: Storage = localStorage, env = environment()): TransportProfile {
  const profiles = getTransportProfiles(storage, env);
  let selectedId = storage.getItem(SELECTED_KEY);
  if (!selectedId) {
    selectedId = storage.getItem(LEGACY_PREFERENCE_KEY) === 'common' ? BUILTIN_SUPABASE_ID : BUILTIN_PEERJS_ID;
  }
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0]!;
  if (storage.getItem(SELECTED_KEY) !== selected.id) storage.setItem(SELECTED_KEY, selected.id);
  return selected;
}

export function selectTransportProfile(id: string, storage: Storage = localStorage, env = environment()): TransportProfile {
  const profile = getTransportProfiles(storage, env).find((item) => item.id === id);
  if (!profile) throw new Error('Transport profile not found');
  storage.setItem(SELECTED_KEY, profile.id);
  return profile;
}

export function saveCustomTransportProfile(
  input: CustomTransportProfileInput,
  id?: string,
  storage: Storage = localStorage,
): TransportProfile {
  const custom = loadCustomProfiles(storage);
  if (input.config.adapter === 'peerjs' && !input.config.serverUrl) {
    throw new Error('PeerServer URL is required for a custom PeerJS profile');
  }
  const profile: TransportProfile = {
    id: id ?? `custom:${createUuid()}`,
    name: validateProfileName(input.name),
    config: validateTransportConfig(input.config),
    custom: true,
  };
  const index = custom.findIndex((item) => item.id === profile.id);
  if (id && index < 0) throw new Error('Transport profile not found');
  if (index >= 0) custom[index] = profile; else custom.push(profile);
  saveCustomProfiles(storage, custom);
  if (!id) storage.setItem(SELECTED_KEY, profile.id);
  return profile;
}

export function deleteCustomTransportProfile(id: string, storage: Storage = localStorage): void {
  const custom = loadCustomProfiles(storage);
  if (!custom.some((profile) => profile.id === id)) throw new Error('Transport profile not found');
  saveCustomProfiles(storage, custom.filter((profile) => profile.id !== id));
  if (storage.getItem(SELECTED_KEY) === id) storage.setItem(SELECTED_KEY, BUILTIN_PEERJS_ID);
}

export function configuredTransport(): TransportConfig {
  return getSelectedTransportProfile().config;
}

export function createTransportAdapter(config: TransportConfig): TransportAdapter {
  const valid = validateTransportConfig(config);
  if (valid.adapter === 'peerjs') {
    return new PeerJSTransportAdapter(valid.serverUrl ? { peerOptions: peerOptionsFromServerUrl(valid.serverUrl) } : {});
  }
  return new CommonTransportAdapter(new SupabaseRealtimeProvider({ url: valid.url, publishableKey: valid.publishableKey }));
}
