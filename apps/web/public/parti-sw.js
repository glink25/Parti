const PREFIX = '/_parti/packages/';
const CACHE_PREFIX = 'parti-package-';
const clientPackages = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(PREFIX)) {
    const hash = packageHashFromPath(url.pathname);
    if (hash && event.request.mode === 'navigate' && event.resultingClientId) {
      clientPackages.set(event.resultingClientId, hash);
    }
    event.respondWith(routePackageRequest(event.request, url));
    return;
  }
  // Sandboxed iframe 的 origin 为 null。Vite 等构建器默认生成 /assets/... 绝对路径，
  // 这里依据发起请求的 iframe client URL 将其重新落到对应 package 根目录；
  // 宿主页面 client URL 不含 PREFIX，因此不会改写宿主自己的静态资源。
  if (event.clientId) event.respondWith(routePackageClientRequest(event));
});

async function routePackageRequest(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const rest = url.pathname.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return new Response('Not Found', { status: 404 });
  const hash = rest.slice(0, slash);
  return respondFromPackage(request, url.origin, hash, rest.slice(slash + 1));
}

async function routePackageClientRequest(event) {
  let hash = clientPackages.get(event.clientId);
  if (!hash) {
    const client = await self.clients.get(event.clientId);
    if (!client) return fetch(event.request);
    hash = packageHashFromPath(new URL(client.url).pathname);
  }
  if (!hash) return fetch(event.request);
  const requestUrl = new URL(event.request.url);
  return respondFromPackage(event.request, requestUrl.origin, hash, requestUrl.pathname.slice(1));
}

function packageHashFromPath(pathname) {
  if (!pathname.startsWith(PREFIX)) return null;
  const rest = pathname.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  return slash > 0 ? rest.slice(0, slash) : null;
}

async function respondFromPackage(request, origin, hash, rawPath) {
  let path = rawPath;
  try { path = decodeURIComponent(path); } catch { return new Response('Bad Request', { status: 400 }); }
  if (!path || path.endsWith('/')) path += 'index.html';
  if (path.split('/').some((part) => !part || part === '.' || part === '..') || path.includes('\\')) {
    return new Response('Bad Request', { status: 400 });
  }
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const key = new Request(`${origin}${PREFIX}${hash}/${encoded}`);
  const cache = await caches.open(CACHE_PREFIX + hash);
  const response = await cache.match(key);
  if (!response) return new Response('Not Found', { status: 404 });
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
  return response;
}
