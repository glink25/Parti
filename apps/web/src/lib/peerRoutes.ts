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

export function buildJoinHashRoute(roomId: string, hostPeerId: string, credential?: string): string {
  const base = `/peer/join/${encodeURIComponent(roomId)}/${encodeURIComponent(hostPeerId)}`;
  return credential ? `${base}?password=${encodeURIComponent(credential)}` : base;
}

function joinHashFromPeerRoute(route: PeerRoute): string | null {
  if (route.mode !== 'join' || !route.roomId || !route.hostPeerId) return null;
  return buildJoinHashRoute(route.roomId, route.hostPeerId, route.credential);
}

function parseInviteInputFromHash(hash: string): string | null {
  const normalized = hash.startsWith('#') ? hash : `#${hash}`;
  return joinHashFromPeerRoute(parsePeerRoute(normalized));
}

const TRAILING_PUNCTUATION = /[。，、；：！？,.;:!?)}\]'"\]]+$/;

function trimTrailingPunctuation(value: string): string {
  return value.replace(TRAILING_PUNCTUATION, '');
}

/** 从分享文本中提取可能的邀请链接片段。 */
function extractInviteCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  if (
    trimmed.startsWith('#/') ||
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith('/peer/join/') ||
    trimmed.startsWith('peer/join/')
  ) {
    return trimmed;
  }

  const httpMatch = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (httpMatch) return trimTrailingPunctuation(httpMatch[0]);

  const hashMatch = trimmed.match(/#\/?peer\/join\/[^\s]+/i);
  if (hashMatch) return hashMatch[0];

  const pathMatch = trimmed.match(/\/?peer\/join\/[^\s]+/i);
  if (pathMatch) {
    const path = pathMatch[0];
    return path.startsWith('/') ? path : `/${path}`;
  }

  return trimmed;
}

function parseInviteInputCore(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('#/')) {
    return parseInviteInputFromHash(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!url.hash) return null;
      return parseInviteInputFromHash(url.hash);
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('/peer/join/')) {
    return parseInviteInputFromHash(trimmed);
  }

  if (trimmed.startsWith('peer/join/')) {
    return parseInviteInputFromHash(`/${trimmed}`);
  }

  return null;
}

/** 从粘贴的完整 URL / hash / 路径片段解析出 join hash 路由（不含 #）。 */
export function parseInviteInput(raw: string): string | null {
  return parseInviteInputCore(extractInviteCandidate(raw));
}

/** 用 replace 进入联机房间，禁止浏览器后退回到大厅前的输入态。 */
export function navigateToPeerJoin(hashRoute: string): void {
  const path = hashRoute.startsWith('/') ? hashRoute : `/${hashRoute}`;
  location.replace(`${location.pathname}${location.search}#${path}`);
}
