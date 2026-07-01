import type { AppLocale } from './locales.js';
import { flattenMessages } from './flattenMessages.js';
import zhCN from './messages/zh-CN.json';
import enUS from './messages/en-US.json';

export const rawMessagesByLocale = {
  'zh-CN': zhCN,
  'en-US': enUS,
} as const;

export const messagesByLocale: Record<AppLocale, Record<string, string>> = {
  'zh-CN': flattenMessages(zhCN),
  'en-US': flattenMessages(enUS),
};

export function getRandomNamePools(locale: AppLocale): { adjectives: string[]; animals: string[] } {
  const raw = rawMessagesByLocale[locale].randomName;
  return {
    adjectives: [...raw.adjectives],
    animals: [...raw.animals],
  };
}
