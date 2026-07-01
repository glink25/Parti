/**
 * 从 ZIP 文件或 GitHub 地址导入房间模版。
 */
import JSZip from 'jszip';
import { createPackage, decodeText, validateManifest, type RoomPackageInput } from '@parti/room-packager';
import { saveImportedTemplate } from './templates.js';

const MANIFEST_NAME = 'parti.room.json';

export type ImportRoomErrorCode =
  | 'MANIFEST_NOT_FOUND'
  | 'MANIFEST_INVALID_JSON'
  | 'UI_ENTRY_MISSING'
  | 'WORKER_ENTRY_MISSING'
  | 'ZIP_MANIFEST_NOT_FOUND'
  | 'GITHUB_URL_INVALID'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_DIR_READ_FAILED'
  | 'GITHUB_MANIFEST_NOT_FOUND'
  | 'DOWNLOAD_FAILED';

export class ImportRoomError extends Error {
  readonly code: ImportRoomErrorCode;
  readonly path?: string;
  readonly status?: number;

  constructor(code: ImportRoomErrorCode, options: { path?: string; status?: number } = {}) {
    super(code);
    this.name = 'ImportRoomError';
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    if (options.status !== undefined) this.status = options.status;
  }
}

/** 由一组文件构造并校验 RoomPackageInput（manifest 取自 parti.room.json）。 */
export async function buildPackageInputFromFiles(
  files: Record<string, Uint8Array>,
): Promise<RoomPackageInput> {
  const manifestRaw = files[MANIFEST_NAME];
  if (manifestRaw === undefined) {
    throw new ImportRoomError('MANIFEST_NOT_FOUND');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(manifestRaw));
  } catch {
    throw new ImportRoomError('MANIFEST_INVALID_JSON');
  }
  const manifest = validateManifest(parsed);
  const { [MANIFEST_NAME]: _ignored, ...rest } = files;
  if (rest[manifest.entry.ui] === undefined) {
    throw new ImportRoomError('UI_ENTRY_MISSING', { path: manifest.entry.ui });
  }
  if (rest[manifest.entry.worker] === undefined) {
    throw new ImportRoomError('WORKER_ENTRY_MISSING', { path: manifest.entry.worker });
  }
  const input: RoomPackageInput = { manifest, files: rest };
  await createPackage(input);
  return input;
}

/** 从 ZIP 导入：自动剥离可能的一层包裹文件夹。返回保存后的模版 id。 */
export async function importRoomFromZip(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((e) => !e.dir);

  const manifestEntries = entries
    .filter((e) => e.name === MANIFEST_NAME || e.name.endsWith(`/${MANIFEST_NAME}`))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length);
  if (manifestEntries.length === 0) {
    throw new ImportRoomError('ZIP_MANIFEST_NOT_FOUND');
  }
  const manifestPath = manifestEntries[0].name;
  const prefix = manifestPath.slice(0, manifestPath.length - MANIFEST_NAME.length);

  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    if (prefix && !entry.name.startsWith(prefix)) continue;
    const rel = entry.name.slice(prefix.length);
    if (!rel) continue;
    files[rel] = await entry.async('uint8array');
  }

  const input = await buildPackageInputFromFiles(files);
  return saveImportedTemplate(input, { type: 'zip', ref: file.name });
}

interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
}

function parseGitHubUrl(url: string): { owner: string; repo: string; ref: string; dir: string } {
  const match = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/(.+?)\/?$/);
  if (!match) {
    throw new ImportRoomError('GITHUB_URL_INVALID');
  }
  const [, owner, repo, ref, rawPath] = match;
  const segments = rawPath.split('/');
  const last = segments[segments.length - 1];
  const dir = last.includes('.') ? segments.slice(0, -1).join('/') : segments.join('/');
  return { owner, repo, ref, dir };
}

async function listGitHubDir(
  owner: string,
  repo: string,
  ref: string,
  dir: string,
): Promise<GitHubContentItem[]> {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 403) {
    throw new ImportRoomError('GITHUB_RATE_LIMITED');
  }
  if (!res.ok) {
    throw new ImportRoomError('GITHUB_DIR_READ_FAILED', { status: res.status });
  }
  const data = (await res.json()) as GitHubContentItem | GitHubContentItem[];
  return Array.isArray(data) ? data : [data];
}

/** 从 GitHub 地址导入：校验同级目录含 parti.room.json，下载整个文件夹。返回模版 id。 */
export async function importRoomFromGitHub(url: string): Promise<string> {
  const { owner, repo, ref, dir } = parseGitHubUrl(url);
  const rootItems = await listGitHubDir(owner, repo, ref, dir);
  if (!rootItems.some((i) => i.type === 'file' && i.name === MANIFEST_NAME)) {
    throw new ImportRoomError('GITHUB_MANIFEST_NOT_FOUND');
  }

  const files: Record<string, Uint8Array> = {};
  const rootDepth = dir === '' ? 0 : dir.split('/').length;
  const relativeOf = (path: string) => path.split('/').slice(rootDepth).join('/');

  async function collect(items: GitHubContentItem[]): Promise<void> {
    for (const item of items) {
      if (item.type === 'dir') {
        await collect(await listGitHubDir(owner, repo, ref, item.path));
      } else if (item.download_url) {
        const res = await fetch(item.download_url);
        if (!res.ok) throw new ImportRoomError('DOWNLOAD_FAILED', { path: item.path });
        files[relativeOf(item.path)] = new Uint8Array(await res.arrayBuffer());
      }
    }
  }
  await collect(rootItems);

  const input = await buildPackageInputFromFiles(files);
  return saveImportedTemplate(input, { type: 'github', ref: url });
}
