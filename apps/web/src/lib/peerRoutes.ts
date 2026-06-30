export interface PeerRoute {
  mode: 'host' | 'join';
  roomId?: string;
  hostPeerId?: string;
  credential?: string;
}

export function parsePeerRoute(hash: string): PeerRoute {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[1] === 'join') {
    return {
      mode: 'join',
      roomId: parts[2] ? decodeURIComponent(parts[2]) : undefined,
      hostPeerId: parts[3] ? decodeURIComponent(parts[3]) : undefined,
      credential: new URLSearchParams(query).get('password') ?? undefined,
    };
  }
  return {
    mode: 'host',
    roomId: parts[2] ? decodeURIComponent(parts[2]) : undefined,
  };
}

export function buildInviteUrl(
  origin: string,
  pathname: string,
  roomId: string,
  hostPeerId: string,
  password = '',
): string {
  const base = `${origin}${pathname}#/peer/join/${encodeURIComponent(roomId)}/${encodeURIComponent(hostPeerId)}`;
  return password ? `${base}?password=${encodeURIComponent(password)}` : base;
}
