/**
 * 从 ZIP 文件或 GitHub 地址导入房间模版。
 *
 * 复用核心逻辑：validateManifest + createPackage（@parti/room-packager）。
 * 校验：必须含 parti.room.json，且其声明的 entry.ui / entry.worker 文件存在。
 * 整个文件夹原样下载，所有文件按文本进 RoomPackageInput.files（不做封面 URL 解析）。
 */
import JSZip from 'jszip';
import { createPackage, validateManifest, type RoomPackageInput } from '@parti/room-packager';
import { saveImportedTemplate } from './templates.js';

const MANIFEST_NAME = 'parti.room.json';

/** 由一组文件构造并校验 RoomPackageInput（manifest 取自 parti.room.json）。 */
export async function buildPackageInputFromFiles(
  files: Record<string, string>,
): Promise<RoomPackageInput> {
  const manifestRaw = files[MANIFEST_NAME];
  if (manifestRaw === undefined) {
    throw new Error('未找到 parti.room.json，无法识别为有效的房间包。');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw);
  } catch {
    throw new Error('parti.room.json 不是有效的 JSON。');
  }
  const manifest = validateManifest(parsed);
  const { [MANIFEST_NAME]: _ignored, ...rest } = files;
  if (rest[manifest.entry.ui] === undefined) {
    throw new Error(`缺少 UI 入口文件：${manifest.entry.ui}`);
  }
  if (rest[manifest.entry.worker] === undefined) {
    throw new Error(`缺少 worker 入口文件：${manifest.entry.worker}`);
  }
  const input: RoomPackageInput = { manifest, files: rest };
  await createPackage(input); // 最终校验 / 算 hash
  return input;
}

/** 从 ZIP 导入：自动剥离可能的一层包裹文件夹。返回保存后的模版 id。 */
export async function importRoomFromZip(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((e) => !e.dir);

  // 找最浅的 parti.room.json 确定根前缀。
  const manifestEntries = entries
    .filter((e) => e.name === MANIFEST_NAME || e.name.endsWith(`/${MANIFEST_NAME}`))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length);
  if (manifestEntries.length === 0) {
    throw new Error('ZIP 中未找到 parti.room.json。');
  }
  const manifestPath = manifestEntries[0].name;
  const prefix = manifestPath.slice(0, manifestPath.length - MANIFEST_NAME.length); // 含尾部 '/' 或为 ''

  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (prefix && !entry.name.startsWith(prefix)) continue;
    const rel = entry.name.slice(prefix.length);
    if (!rel) continue;
    files[rel] = await entry.async('string');
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

/** 解析 github 网页地址，确定包所在文件夹。 */
function parseGitHubUrl(url: string): { owner: string; repo: string; ref: string; dir: string } {
  const match = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/(.+?)\/?$/);
  if (!match) {
    throw new Error('无法识别的 GitHub 地址，请提供指向文件或文件夹的 blob/tree 链接。');
  }
  const [, owner, repo, ref, rawPath] = match;
  const segments = rawPath.split('/');
  const last = segments[segments.length - 1];
  // 末段是带扩展名的文件 → 取其同级目录；否则路径本身即文件夹。
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
    throw new Error('GitHub API 请求受限（未认证限速 60 次/时），请稍后再试。');
  }
  if (!res.ok) {
    throw new Error(`读取 GitHub 目录失败（${res.status}）。`);
  }
  const data = (await res.json()) as GitHubContentItem | GitHubContentItem[];
  return Array.isArray(data) ? data : [data];
}

/** 从 GitHub 地址导入：校验同级目录含 parti.room.json，下载整个文件夹。返回模版 id。 */
export async function importRoomFromGitHub(url: string): Promise<string> {
  const { owner, repo, ref, dir } = parseGitHubUrl(url);
  const rootItems = await listGitHubDir(owner, repo, ref, dir);
  if (!rootItems.some((i) => i.type === 'file' && i.name === MANIFEST_NAME)) {
    throw new Error('该地址对应的文件夹下未找到 parti.room.json。');
  }

  const files: Record<string, string> = {};
  const rootDepth = dir === '' ? 0 : dir.split('/').length;
  const relativeOf = (path: string) => path.split('/').slice(rootDepth).join('/');

  async function collect(items: GitHubContentItem[]): Promise<void> {
    for (const item of items) {
      if (item.type === 'dir') {
        await collect(await listGitHubDir(owner, repo, ref, item.path));
      } else if (item.download_url) {
        const res = await fetch(item.download_url);
        if (!res.ok) throw new Error(`下载文件失败：${item.path}`);
        files[relativeOf(item.path)] = await res.text();
      }
    }
  }
  await collect(rootItems);

  const input = await buildPackageInputFromFiles(files);
  return saveImportedTemplate(input, { type: 'github', ref: url });
}
