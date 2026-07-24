/**
 * "邀请 AI" 警告弹窗的本地偏好。
 *
 * 记录用户是否勾选了"不再提示"。一旦为真，点击"邀请 AI"入口将直接复制提示词，
 * 不再弹出警告。偏好通过注入的 Storage（默认 localStorage）持久化，保持纯逻辑可测。
 */

const WARNING_DISMISSED_KEY = 'parti:invite-ai-warning-dismissed:v1';

export function isInviteAiWarningDismissed(storage: Storage = safeLocalStorage()): boolean {
  try {
    return storage.getItem(WARNING_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setInviteAiWarningDismissed(dismissed: boolean, storage: Storage = safeLocalStorage()): void {
  try {
    if (dismissed) storage.setItem(WARNING_DISMISSED_KEY, 'true');
    else storage.removeItem(WARNING_DISMISSED_KEY);
  } catch {
    /* 存储不可用时静默降级：不影响复制提示词。 */
  }
}

/** 在无 window / 存储被禁用的环境下退化为一个无副作用的内存 Storage。 */
function safeLocalStorage(): Storage {
  if (typeof window !== 'undefined') {
    try {
      return window.localStorage;
    } catch {
      /* fall through to no-op storage */
    }
  }
  return NOOP_STORAGE;
}

const NOOP_STORAGE: Storage = {
  length: 0,
  clear() {},
  getItem() { return null; },
  key() { return null; },
  removeItem() {},
  setItem() {},
};
