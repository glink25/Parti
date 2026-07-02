import type { AppLocale } from '@/i18n/locales';
import { getRandomNamePools } from '@/i18n/messages';

export interface LocalUser {
  id: string;
  name: string;
}

const STORAGE_KEY = 'parti:user';
export const MAX_USER_NAME_LENGTH = 24;

let memoryUser: LocalUser | null = null;

export type UserNameValidationCode = 'empty' | 'tooLong';

export class UserNameValidationError extends Error {
  readonly code: UserNameValidationCode;
  readonly maxLength?: number;

  constructor(code: UserNameValidationCode, maxLength?: number) {
    super(code);
    this.name = 'UserNameValidationError';
    this.code = code;
    if (maxLength !== undefined) this.maxLength = maxLength;
  }
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function randomIndex(length: number): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function createUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `user_${crypto.randomUUID()}`;
  }
  return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function createRandomName(locale: AppLocale): string {
  const { adjectives, animals } = getRandomNamePools(locale);
  const number = String(randomIndex(10_000)).padStart(4, '0');
  return `${adjectives[randomIndex(adjectives.length)]}${animals[randomIndex(animals.length)]} ${number}`;
}

function isLocalUser(value: unknown): value is LocalUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<LocalUser>;
  return (
    typeof user.id === 'string' &&
    user.id.startsWith('user_') &&
    typeof user.name === 'string' &&
    user.name.trim().length > 0 &&
    user.name.trim().length <= MAX_USER_NAME_LENGTH
  );
}

function persist(user: LocalUser, storage = localStorageOrUndefined()): void {
  memoryUser = user;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // localStorage 不可用或配额超限时，至少在当前页面生命周期内保持稳定身份。
  }
}

export function loadLocalUser(storage = localStorageOrUndefined(), locale: AppLocale = 'zh-CN'): LocalUser {
  let storedValueWasInvalid = false;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isLocalUser(parsed)) {
          const user = { id: parsed.id, name: parsed.name.trim() };
          memoryUser = user;
          return user;
        }
      } catch {
        // 下方会用一份全新身份覆盖损坏记录。
      }
      storedValueWasInvalid = true;
    }
  } catch {
    // 不可访问时复用当前页面内存身份。
  }

  if (memoryUser && !storedValueWasInvalid) return memoryUser;
  const user = { id: createUserId(), name: createRandomName(locale) };
  persist(user, storage);
  return user;
}

export function saveLocalUserName(name: string, storage = localStorageOrUndefined()): LocalUser {
  const normalized = name.trim();
  if (!normalized) throw new UserNameValidationError('empty');
  if (normalized.length > MAX_USER_NAME_LENGTH) {
    throw new UserNameValidationError('tooLong', MAX_USER_NAME_LENGTH);
  }
  const user = { ...loadLocalUser(storage), name: normalized };
  persist(user, storage);
  return user;
}
