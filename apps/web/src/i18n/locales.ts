export const LOCALES = ['zh-CN', 'en-US'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'zh-CN';
export const LOCALE_STORAGE_KEY = 'parti:locale';

export function isAppLocale(value: string): value is AppLocale {
  return (LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): AppLocale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && isAppLocale(stored)) return stored;
  } catch {
    // localStorage unavailable
  }
  return null;
}

export function detectLocale(): AppLocale {
  const stored = readStoredLocale();
  if (stored) return stored;

  const language = typeof navigator !== 'undefined' ? navigator.language : '';
  if (language.toLowerCase().startsWith('zh')) return 'zh-CN';
  return 'en-US';
}

export const LOCALE_LABELS: Record<AppLocale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
};
