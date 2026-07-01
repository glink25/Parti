export interface LocalUser {
  id: string;
  name: string;
}

const STORAGE_KEY = 'parti:user';
export const MAX_USER_NAME_LENGTH = 24;

const ADJECTIVES = ['快乐', '勇敢', '闪亮', '悠闲', '机灵', '温柔', '幸运', '热情'];
const ANIMALS = ['海獭', '熊猫', '狐狸', '水豚', '企鹅', '浣熊', '兔子', '橘猫'];

let memoryUser: LocalUser | null = null;

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

function createRandomName(): string {
  const number = String(randomIndex(10_000)).padStart(4, '0');
  return `${ADJECTIVES[randomIndex(ADJECTIVES.length)]}${ANIMALS[randomIndex(ANIMALS.length)]} ${number}`;
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

export function loadLocalUser(storage = localStorageOrUndefined()): LocalUser {
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
  const user = { id: createUserId(), name: createRandomName() };
  persist(user, storage);
  return user;
}

export function saveLocalUserName(name: string, storage = localStorageOrUndefined()): LocalUser {
  const normalized = name.trim();
  if (!normalized) throw new Error('用户名不能为空');
  if (normalized.length > MAX_USER_NAME_LENGTH) {
    throw new Error(`用户名不能超过 ${MAX_USER_NAME_LENGTH} 个字符`);
  }
  const user = { ...loadLocalUser(storage), name: normalized };
  persist(user, storage);
  return user;
}
