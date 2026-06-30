/**
 * Room Package 模型与加载 (GOAL.md §4.2, §11)。
 *
 * 一个房间包 = manifest + 一组文件（HTML / worker / css / 资源）。
 * MVP 通过静态 URL 加载（无后端）；内容寻址 hash 见 hash.ts。
 */
import { validateManifest, type RoomManifest } from './manifest.js';
import { hashPackage } from './hash.js';

export interface RoomPackage {
  manifest: RoomManifest;
  /** 相对路径 -> 文本内容 */
  files: Record<string, string>;
  /** 内容寻址哈希（sha256） */
  packageHash: string;
}

export interface RoomPackageInput {
  manifest: unknown;
  files: Record<string, string>;
}

/** 从内存中的 manifest + 文件构造 Room Package，并计算 packageHash。 */
export async function createPackage(input: RoomPackageInput): Promise<RoomPackage> {
  const manifest = validateManifest(input.manifest);
  const packageHash = await hashPackage(manifest, input.files);
  return { manifest, files: input.files, packageHash };
}

/** Room UI 的 HTML 入口内容。 */
export function getRoomHtml(pkg: RoomPackage): string {
  const html = pkg.files[pkg.manifest.entry.ui];
  if (html === undefined) {
    throw new Error(`Room Package 缺少 UI 入口: ${pkg.manifest.entry.ui}`);
  }
  return html;
}

/** room.worker.js 源码。 */
export function getWorkerSource(pkg: RoomPackage): string {
  const src = pkg.files[pkg.manifest.entry.worker];
  if (src === undefined) {
    throw new Error(`Room Package 缺少 Worker 入口: ${pkg.manifest.entry.worker}`);
  }
  return src;
}

/**
 * 从静态 baseUrl 加载 Room Package（fetch parti.room.json 与各入口文件）。
 * 例如 baseUrl = '/rooms/counter/'。
 */
export async function loadPackageFromUrl(baseUrl: string): Promise<RoomPackage> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const manifestRaw = await fetchText(`${base}parti.room.json`);
  const manifest = validateManifest(JSON.parse(manifestRaw));

  const files: Record<string, string> = {};
  const entryFiles = [
    manifest.entry.ui,
    manifest.entry.worker,
    manifest.entry.client,
    manifest.entry.style,
  ].filter((f): f is string => typeof f === 'string');

  for (const file of entryFiles) {
    files[file] = await fetchText(`${base}${file}`);
  }

  const packageHash = await hashPackage(manifest, files);
  return { manifest, files, packageHash };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url}: ${res.status}`);
  return res.text();
}
