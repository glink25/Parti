import { validateTransportConfig, type TransportConfig } from './transportConfig';

export interface PeerRoute {
  mode: 'host' | 'join'; roomId?: string; hostPeerId?: string; credential?: string; transportConfig: TransportConfig;
}

function configFromQuery(query: URLSearchParams, legacy: boolean): TransportConfig {
  const adapter = query.get('adapter');
  if (legacy || !adapter) return { adapter: 'peerjs' };
  if (adapter === 'peerjs') {
    return validateTransportConfig({ adapter: 'peerjs', ...(query.get('server') ? { serverUrl: query.get('server')! } : {}) });
  }
  if (adapter === 'lan') {
    return validateTransportConfig({ adapter: 'lan', ...(query.get('server') ? { serverUrl: query.get('server')! } : {}) });
  }
  if (adapter !== 'common' || query.get('provider') !== 'supabase') throw new Error('Unsupported transport configuration');
  return validateTransportConfig({
    adapter: 'common', provider: 'supabase', url: query.get('url') ?? '', publishableKey: query.get('key') ?? '',
  });
}

export function parsePeerRoute(hash: string): PeerRoute {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path!.split('/').filter(Boolean);
  const legacy = parts[0] === 'peer';
  const online = parts[0] === 'online';
  const params = new URLSearchParams(query);
  if ((legacy || online) && parts[1] === 'join') return {
    mode: 'join', roomId: parts[2] ? decodeURIComponent(parts[2]) : undefined,
    hostPeerId: parts[3] ? decodeURIComponent(parts[3]) : undefined,
    credential: params.get('password') ?? undefined, transportConfig: configFromQuery(params, legacy),
  };
  return { mode: 'host', roomId: parts[2] ? decodeURIComponent(parts[2]) : undefined, transportConfig: { adapter: 'peerjs' } };
}

function configParams(config: TransportConfig, password = ''): URLSearchParams {
  const params = new URLSearchParams({ adapter: config.adapter });
  if (config.adapter === 'peerjs' && config.serverUrl) params.set('server', config.serverUrl);
  if (config.adapter === 'lan' && config.serverUrl) params.set('server', config.serverUrl);
  if (config.adapter === 'common') {
    params.set('provider', config.provider); params.set('url', config.url); params.set('key', config.publishableKey);
  }
  if (password) params.set('password', password);
  return params;
}

export function buildInviteUrl(origin: string, pathname: string, roomId: string, connectionInfo: string, password = '', config: TransportConfig = { adapter: 'peerjs' }): string {
  return `${origin}${pathname}#${buildJoinHashRoute(roomId, connectionInfo, password, config)}`;
}

export function buildJoinHashRoute(roomId: string, connectionInfo: string, credential?: string, config: TransportConfig = { adapter: 'peerjs' }): string {
  return `/online/join/${encodeURIComponent(roomId)}/${encodeURIComponent(connectionInfo)}?${configParams(config, credential).toString()}`;
}

function parseHash(hash: string): string | null {
  try {
    const route = parsePeerRoute(hash.startsWith('#') ? hash : `#${hash}`);
    return route.mode === 'join' && route.roomId && route.hostPeerId
      ? buildJoinHashRoute(route.roomId, route.hostPeerId, route.credential, route.transportConfig) : null;
  } catch { return null; }
}

const TRAILING = /[。，、；：！？,.;:!?)}\]'"\]]+$/;
export function parseInviteInput(raw: string): string | null {
  const text = raw.trim();
  const match = text.match(/https?:\/\/[^\s<>"']+|#\/?(?:peer|online)\/join\/[^\s]+|\/?(?:peer|online)\/join\/[^\s]+/i);
  const candidate = (match?.[0] ?? text).replace(TRAILING, '');
  if (/^https?:\/\//i.test(candidate)) { try { return parseHash(new URL(candidate).hash); } catch { return null; } }
  if (candidate.startsWith('#')) return parseHash(candidate);
  if (/^\/?(?:peer|online)\/join\//i.test(candidate)) return parseHash(candidate.startsWith('/') ? candidate : `/${candidate}`);
  return null;
}

export function navigateToPeerJoin(hashRoute: string): void {
  location.replace(`${location.pathname}${location.search}#${hashRoute.startsWith('/') ? hashRoute : `/${hashRoute}`}`);
}
