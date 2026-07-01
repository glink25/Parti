import { buildRoomDocument } from '@parti/client-sdk';
import {
  encodeText,
  getRoomHtml,
  mimeTypeForPath,
  normalizePackagePath,
  type RoomPackage,
} from '@parti/room-packager';

const VIRTUAL_PREFIX = '/_parti/packages/';
const CACHE_PREFIX = 'parti-package-';
const SERVICE_WORKER_URL = '/parti-sw.js?v=20260701-2';
const references = new Map<string, number>();
const mounts = new Map<string, Promise<void>>();
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('parti-package-mounts');

channel?.addEventListener('message', (event: MessageEvent<{ type: string; hash: string; requestId: string }>) => {
  const message = event.data;
  if (message?.type === 'query' && (references.get(message.hash) ?? 0) > 0) {
    channel.postMessage({ type: 'active', hash: message.hash, requestId: message.requestId });
  }
});

export interface PackageUrlHandle {
  url: string;
  dispose(): void;
}

export async function createPackageUrl(pkg: RoomPackage): Promise<PackageUrlHandle> {
  if (pkg.manifest.packageMode === 'blob') {
    const url = URL.createObjectURL(new Blob([buildRoomDocument(getRoomHtml(pkg))], { type: 'text/html;charset=utf-8' }));
    return { url, dispose: () => URL.revokeObjectURL(url) };
  }
  return mountFilesystemPackage(pkg);
}

async function mountFilesystemPackage(pkg: RoomPackage): Promise<PackageUrlHandle> {
  if (!('serviceWorker' in navigator) || !('caches' in globalThis)) {
    throw new Error('此 Package 需要 Service Worker 虚拟文件系统，但当前环境不支持');
  }
  await ensureServiceWorkerControl();

  const hash = pkg.packageHash;
  const count = references.get(hash) ?? 0;
  references.set(hash, count + 1);
  let mounting = mounts.get(hash);
  if (!mounting) {
    mounting = writePackageCache(pkg).finally(() => mounts.delete(hash));
    mounts.set(hash, mounting);
  }
  try {
    await mounting;
  } catch (error) {
    const next = (references.get(hash) ?? 1) - 1;
    if (next > 0) references.set(hash, next); else references.delete(hash);
    throw error;
  }

  const entry = encodeVirtualPath(pkg.manifest.entry.ui);
  const url = `${VIRTUAL_PREFIX}${hash}/${entry}`;
  try {
    const probe = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!probe.ok || probe.headers.get('X-Parti-Package-Hash') !== hash) {
      throw new Error('虚拟 Package URL 未被 Parti Service Worker 接管');
    }
  } catch (error) {
    releasePackageReference(hash);
    throw error;
  }
  let disposed = false;
  return {
    url,
    dispose() {
      if (disposed) return;
      disposed = true;
      releasePackageReference(hash);
    },
  };
}

async function writePackageCache(pkg: RoomPackage): Promise<void> {
  const cache = await caches.open(CACHE_PREFIX + pkg.packageHash);
  for (const [rawPath, originalBytes] of Object.entries(pkg.files)) {
    const path = normalizePackagePath(rawPath);
    const bytes = path === pkg.manifest.entry.ui
      ? encodeText(buildRoomDocument(getRoomHtml(pkg)))
      : originalBytes;
    const request = new Request(`${location.origin}${VIRTUAL_PREFIX}${pkg.packageHash}/${encodeVirtualPath(path)}`);
    await cache.put(request, new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': mimeTypeForPath(path), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Parti-Package-Hash': pkg.packageHash } }));
  }
}

async function ensureServiceWorkerControl(): Promise<void> {
  const expectedUrl = new URL(SERVICE_WORKER_URL, location.href).href;
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: '/',
    updateViaCache: 'none',
  });
  await registration.update();
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller?.scriptURL === expectedUrl) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      reject(new Error('Parti Service Worker 已激活，但未能接管当前页面；请刷新后重试'));
    }, 10_000);
    const onChange = () => {
      if (navigator.serviceWorker.controller?.scriptURL !== expectedUrl) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    onChange();
  });
}

function releasePackageReference(hash: string): void {
  const next = (references.get(hash) ?? 1) - 1;
  if (next > 0) references.set(hash, next);
  else {
    references.delete(hash);
    void deleteIfUnused(hash);
  }
}

function encodeVirtualPath(path: string): string {
  return normalizePackagePath(path).split('/').map(encodeURIComponent).join('/');
}

export async function clearStalePackageCaches(): Promise<void> {
  if (!('caches' in globalThis)) return;
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => deleteIfUnused(name.slice(CACHE_PREFIX.length))));
}

async function deleteIfUnused(hash: string): Promise<void> {
  if ((references.get(hash) ?? 0) > 0 || !channel) return;
  const requestId = crypto.randomUUID();
  let active = false;
  const listener = (event: MessageEvent<{ type: string; hash: string; requestId: string }>) => {
    const message = event.data;
    if (message?.type === 'active' && message.hash === hash && message.requestId === requestId) active = true;
  };
  channel.addEventListener('message', listener);
  channel.postMessage({ type: 'query', hash, requestId });
  await new Promise((resolve) => setTimeout(resolve, 75));
  channel.removeEventListener('message', listener);
  if (!active && (references.get(hash) ?? 0) === 0) await caches.delete(CACHE_PREFIX + hash);
}
