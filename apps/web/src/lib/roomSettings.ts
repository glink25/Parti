import type { RoomAdmissionController } from '@parti/core';

export interface HostRoomSettings {
  title: string;
  password: string;
  isPublic: boolean;
  replayEnabled: boolean;
}

const PREFIX = 'parti:host-settings:';

export function loadHostRoomSettings(roomId: string): HostRoomSettings | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + roomId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HostRoomSettings>;
    if (typeof parsed.title !== 'string' || typeof parsed.password !== 'string' || typeof parsed.isPublic !== 'boolean') return null;
    return { ...parsed, replayEnabled: parsed.replayEnabled === true } as HostRoomSettings;
  } catch {
    return null;
  }
}

export function saveHostRoomSettings(
  roomId: string,
  settings: HostRoomSettings,
): void {
  sessionStorage.setItem(PREFIX + roomId, JSON.stringify(settings));
}

export function clearHostRoomSettings(roomId: string): void {
  sessionStorage.removeItem(PREFIX + roomId);
}

export function createPasswordAdmissionController(
  password: string,
): RoomAdmissionController | undefined {
  if (!password) return undefined;
  return {
    authorize(request) {
      if (!request.credential) {
        return {
          allowed: false,
          code: 'CREDENTIAL_REQUIRED',
          message: '该房间需要密码',
        };
      }
      return request.credential === password
        ? { allowed: true }
        : {
            allowed: false,
            code: 'INVALID_CREDENTIAL',
            message: '房间密码错误',
          };
    },
  };
}

export function generateRoomPassword(): string {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 10_000).padStart(4, '0');
}
