import { createDraftId } from '@/lib/ids';
import type { AppLocale } from '@/i18n/locales';
import { rawMessagesByLocale } from '@/i18n/messages';
import type { TemplateListEntry } from '@/lib/rooms';

export type EditorFile = 'manifest' | 'html' | 'worker';
export type BlankChoice = { id: 'blank'; name: string; description: string };
export type SelectableTemplate = BlankChoice | TemplateListEntry;

export function getBlankTemplate(locale: AppLocale): BlankChoice {
  const defaults = rawMessagesByLocale[locale].editor.defaults;
  return {
    id: 'blank',
    name: defaults.blankName,
    description: defaults.blankDescription,
  };
}

export function getAiRoomPrompt(locale: AppLocale): string {
  return rawMessagesByLocale[locale].editor.ai.prompt;
}

export function getDefaultHtml(locale: AppLocale): string {
  return rawMessagesByLocale[locale].editor.defaults.html;
}

export const DEFAULT_WORKER = `import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() { return { count: 0 }; },
  actions: {
    increment(ctx) {
      ctx.state.count += 1;
      ctx.broadcast('counter:incremented', { count: ctx.state.count });
    },
  },
});`;

export function blankManifest(locale: AppLocale): string {
  const defaults = rawMessagesByLocale[locale].editor.defaults;
  return JSON.stringify({
    partiVersion: '0.1.0',
    protocolVersion: 1,
    id: createDraftId(),
    name: defaults.roomName,
    version: '0.1.0',
    packageMode: 'blob',
    description: defaults.roomDescription,
    entry: { ui: 'index.html', worker: 'room.worker.js' },
    room: { minPlayers: 1, maxPlayers: 8 },
    sync: { mode: 'snapshot' },
    permissions: { network: false, storage: 'session' },
  }, null, 2);
}
