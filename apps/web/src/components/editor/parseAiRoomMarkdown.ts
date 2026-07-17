export type AiRoomFiles = {
  manifest: string;
  html: string;
  worker: string;
};

export type ParseAiRoomResult =
  | { ok: true; files: AiRoomFiles }
  | { ok: false; missing: Array<keyof AiRoomFiles> };

type FileKey = keyof AiRoomFiles;

type FenceBlock = {
  info: string;
  body: string;
  preceding: string;
};

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

const MANIFEST_NAMES = ['parti.room.json', 'manifest.json'];
const HTML_NAMES = ['index.html'];
const WORKER_NAMES = ['room.worker.js', 'worker.js'];

function normalizeInfo(info: string): string {
  return info.trim().toLowerCase().replace(/^["']|["']$/g, '');
}

function precedingHint(text: string): string {
  const lines = text.split(/\r?\n/).slice(-6).join('\n').toLowerCase();
  return lines;
}

function matchByFilename(haystack: string): FileKey | null {
  for (const name of MANIFEST_NAMES) {
    if (haystack.includes(name)) return 'manifest';
  }
  for (const name of HTML_NAMES) {
    if (haystack.includes(name)) return 'html';
  }
  for (const name of WORKER_NAMES) {
    if (haystack.includes(name)) return 'worker';
  }
  return null;
}

function matchByLanguage(info: string, body: string, preceding: string): FileKey | null {
  const fromPreceding = matchByFilename(precedingHint(preceding));
  if (fromPreceding) return fromPreceding;

  const lang = info.split(/\s+/)[0] ?? '';
  if (lang === 'json' || lang === 'jsonc') {
    if (/"entry"\s*:/.test(body) || /"schema"\s*:/.test(body) || /"name"\s*:/.test(body)) {
      return 'manifest';
    }
    return 'manifest';
  }
  if (lang === 'html' || lang === 'htm') return 'html';
  if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts') {
    return 'worker';
  }
  return null;
}

function classifyBlock(block: FenceBlock): FileKey | null {
  const info = normalizeInfo(block.info);
  const byInfoName = matchByFilename(info);
  if (byInfoName) return byInfoName;

  const byPreceding = matchByFilename(precedingHint(block.preceding));
  if (byPreceding) return byPreceding;

  return matchByLanguage(info, block.body, block.preceding);
}

function extractFences(markdown: string): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let lastIndex = 0;
  for (const match of markdown.matchAll(FENCE_RE)) {
    const full = match[0];
    const info = match[1] ?? '';
    const body = match[2] ?? '';
    const index = match.index ?? 0;
    blocks.push({
      info,
      body: body.replace(/\n$/, ''),
      preceding: markdown.slice(lastIndex, index),
    });
    lastIndex = index + full.length;
  }
  return blocks;
}

/** 从 AI 回复的 Markdown 中解析 parti.room.json / index.html / room.worker.js。 */
export function parseAiRoomMarkdown(markdown: string): ParseAiRoomResult {
  const files: Partial<AiRoomFiles> = {};
  const blocks = extractFences(markdown);

  for (const block of blocks) {
    const key = classifyBlock(block);
    if (!key || files[key] !== undefined) continue;
    if (!block.body.trim()) continue;
    files[key] = block.body;
  }

  const missing = (['manifest', 'html', 'worker'] as FileKey[]).filter((key) => !files[key]);
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    files: {
      manifest: files.manifest!,
      html: files.html!,
      worker: files.worker!,
    },
  };
}
