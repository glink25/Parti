import { PARTI_VERSION } from '@parti/core';

export const DEFAULT_LAN_SIGNALING_URL = 'wss://public.localsend.org/v1/ws';
export const LAN_TOKEN_PREFIX = 'parti.lan.v1.';
export const LAN_PROTOCOL_VERSION = 1;

const MAX_TOKEN_LENGTH = 2048;
const MAX_ID_LENGTH = 128;

export interface LanRoomAnnouncement {
  title: string;
  packageName: string;
  playerCount: number;
  maxPlayers: number | null;
  joinable: boolean;
  credentialRequired: boolean;
}

export type LanPeerPresence =
  | { role: 'observer'; instanceId: string }
  | {
      role: 'host';
      instanceId: string;
      hostId: string;
      roomId: string;
      announcement?: LanRoomAnnouncement;
    }
  | {
      role: 'client';
      instanceId: string;
      transportPeerId: string;
      targetHostId: string;
      roomId: string;
    };

export interface LocalSendClientInfo {
  id: string;
  alias: string;
  version: string;
  deviceModel?: string;
  deviceType?: 'MOBILE' | 'DESKTOP' | 'WEB' | 'HEADLESS' | 'SERVER';
  token: string;
}

export type LocalSendServerMessage =
  | { type: 'HELLO'; client: LocalSendClientInfo; peers: LocalSendClientInfo[] }
  | { type: 'JOIN'; peer: LocalSendClientInfo }
  | { type: 'UPDATE'; peer: LocalSendClientInfo }
  | { type: 'LEFT'; peerId: string }
  | { type: 'OFFER' | 'ANSWER'; peer: LocalSendClientInfo; sessionId: string; sdp: string }
  | { type: 'ERROR'; code: number };

export type LocalSendClientMessage =
  | { type: 'UPDATE'; info: Omit<LocalSendClientInfo, 'id'> }
  | { type: 'OFFER' | 'ANSWER'; sessionId: string; target: string; sdp: string };

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function validAnnouncement(value: unknown): value is LanRoomAnnouncement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const room = value as Partial<LanRoomAnnouncement>;
  return typeof room.title === 'string'
    && room.title.trim().length > 0
    && room.title.length <= 80
    && typeof room.packageName === 'string'
    && room.packageName.length > 0
    && room.packageName.length <= 120
    && Number.isInteger(room.playerCount)
    && room.playerCount! >= 0
    && (room.maxPlayers === null || (Number.isInteger(room.maxPlayers) && room.maxPlayers! > 0))
    && typeof room.joinable === 'boolean'
    && typeof room.credentialRequired === 'boolean';
}

function validatePresence(value: unknown): LanPeerPresence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const presence = value as Record<string, unknown>;
  if (!validId(presence.instanceId)) return null;
  if (presence.role === 'observer') {
    return { role: 'observer', instanceId: presence.instanceId };
  }
  if (presence.role === 'host' && validId(presence.hostId) && validId(presence.roomId)) {
    if (presence.announcement !== undefined && !validAnnouncement(presence.announcement)) return null;
    return {
      role: 'host',
      instanceId: presence.instanceId,
      hostId: presence.hostId,
      roomId: presence.roomId,
      ...(presence.announcement ? { announcement: presence.announcement } : {}),
    };
  }
  if (presence.role === 'client'
    && validId(presence.transportPeerId)
    && validId(presence.targetHostId)
    && validId(presence.roomId)) {
    return {
      role: 'client',
      instanceId: presence.instanceId,
      transportPeerId: presence.transportPeerId,
      targetHostId: presence.targetHostId,
      roomId: presence.roomId,
    };
  }
  return null;
}

export function encodeLanPeerToken(presence: LanPeerPresence): string {
  const valid = validatePresence(presence);
  if (!valid) throw new Error('Invalid LAN peer presence');
  const token = LAN_TOKEN_PREFIX + encodeBase64Url(JSON.stringify({ partiVersion: PARTI_VERSION, presence: valid }));
  if (token.length > MAX_TOKEN_LENGTH) throw new Error('LAN peer presence is too large');
  return token;
}

export function decodeLanPeerToken(token: string): LanPeerPresence | null {
  if (!token.startsWith(LAN_TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) return null;
  try {
    const envelope = JSON.parse(decodeBase64Url(token.slice(LAN_TOKEN_PREFIX.length))) as {
      partiVersion?: unknown;
      presence?: unknown;
    };
    if (envelope.partiVersion !== PARTI_VERSION) return null;
    return validatePresence(envelope.presence);
  } catch {
    return null;
  }
}

export function localSendInfo(presence: LanPeerPresence): Omit<LocalSendClientInfo, 'id'> {
  return {
    alias: presence.role === 'host' && presence.announcement ? `Parti · ${presence.announcement.title}` : 'Parti',
    version: '2.3',
    deviceModel: 'Parti Web',
    deviceType: 'WEB',
    token: encodeLanPeerToken(presence),
  };
}

export function encodeSignalingDescription(description: RTCSessionDescriptionInit): string {
  return encodeBase64Url(JSON.stringify({ v: LAN_PROTOCOL_VERSION, description }));
}

export function decodeSignalingDescription(value: string): RTCSessionDescriptionInit | null {
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as { v?: unknown; description?: RTCSessionDescriptionInit };
    const description = parsed.description;
    if (parsed.v !== LAN_PROTOCOL_VERSION || !description || (description.type !== 'offer' && description.type !== 'answer') || typeof description.sdp !== 'string') return null;
    return description;
  } catch {
    return null;
  }
}
