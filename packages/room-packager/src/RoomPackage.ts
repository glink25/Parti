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
  /** 规范化相对路径 -> 原始文件字节 */
  files: Record<string, Uint8Array>;
  /** 内容寻址哈希（sha256） */
  packageHash: string;
}

export interface RoomPackageInput {
  manifest: unknown;
  files: Record<string, Uint8Array>;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export function encodeText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function decodeText(value: Uint8Array): string {
  return textDecoder.decode(value);
}

export function normalizePackagePath(input: string): string {
  if (!input || input.startsWith('/') || input.includes('\\') || input.includes('?') || input.includes('#')) {
    throw new Error(`非法 Package 路径: ${input}`);
  }
  let decoded: string;
  try { decoded = decodeURIComponent(input); } catch { throw new Error(`非法 Package 路径编码: ${input}`); }
  if (decoded !== input) throw new Error(`Package 路径必须使用未编码的规范形式: ${input}`);
  const segments = decoded.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`非法 Package 路径: ${input}`);
  }
  return segments.join('/');
}

export function mimeTypeForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8', wasm: 'application/wasm' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

export function encodeFilesBase64(files: Record<string, Uint8Array>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files)) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    result[path] = btoa(binary);
  }
  return result;
}

export function decodeFilesBase64(files: Record<string, string>): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  for (const [path, encoded] of Object.entries(files)) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    result[path] = bytes;
  }
  return result;
}

/** 从内存中的 manifest + 文件构造 Room Package，并计算 packageHash。 */
export async function createPackage(input: RoomPackageInput): Promise<RoomPackage> {
  const manifest = validateManifest(input.manifest);
  const files: Record<string, Uint8Array> = {};
  for (const [rawPath, bytes] of Object.entries(input.files)) {
    const path = normalizePackagePath(rawPath);
    if (files[path]) throw new Error(`重复 Package 路径: ${path}`);
    files[path] = bytes;
  }
  normalizePackagePath(manifest.entry.ui);
  normalizePackagePath(manifest.entry.worker);
  const packageHash = await hashPackage(manifest, files);
  return { manifest, files, packageHash };
}

/** Room UI 的 HTML 入口内容。 */
export function getRoomHtml(pkg: RoomPackage): string {
  const html = pkg.files[pkg.manifest.entry.ui];
  if (html === undefined) {
    throw new Error(`Room Package 缺少 UI 入口: ${pkg.manifest.entry.ui}`);
  }
  return decodeText(html);
}

/** room.worker.js 源码。 */
export function getWorkerSource(pkg: RoomPackage): string {
  const src = pkg.files[pkg.manifest.entry.worker];
  if (src === undefined) {
    throw new Error(`Room Package 缺少 Worker 入口: ${pkg.manifest.entry.worker}`);
  }
  return decodeText(src);
}

/**
 * 从静态 baseUrl 加载 Room Package（fetch parti.room.json 与各入口文件）。
 * 例如 baseUrl = '/rooms/counter/'。
 */
export async function loadPackageFromUrl(baseUrl: string, filePaths: string[]): Promise<RoomPackage> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const manifestRaw = await fetchBytes(`${base}parti.room.json`);
  const manifest = validateManifest(JSON.parse(decodeText(manifestRaw)));

  const files: Record<string, Uint8Array> = {};
  for (const file of filePaths) {
    if (file === 'parti.room.json') continue;
    const path = normalizePackagePath(file);
    files[path] = await fetchBytes(`${base}${path.split('/').map(encodeURIComponent).join('/')}`);
  }
  return createPackage({ manifest, files });
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
