/**
 * 非安全上下文（通过 IP 地址 + HTTP 访问，非 https / 非 localhost）下，
 * 浏览器不暴露 Web Crypto 的 `crypto.subtle`，导致 room-packager 的
 * `sha256Hex()`（`crypto.subtle.digest('SHA-256', ...)`）抛
 * `Cannot read properties of undefined (reading 'digest')`。
 *
 * 这里用 webcrypto-liner 的纯 JS 实现按需补齐 `crypto.subtle`：
 * - 仅开发环境启用，生产构建不包含该 fallback；
 * - 安全上下文 / localhost 下原生 subtle 存在，此处为 no-op，保留原生实现；
 * - dev 下 crypto 不存在时替换整个实现；仅缺 subtle 时只补 subtle。
 *
 * 注意：必须在任何用到 `crypto.subtle` 的代码之前执行，故由 main.tsx 的 bootstrap 先 await。
 * 必须用 module 构建（见 vite.config.ts 的 alias），shim 产物不自包含会同样失败。
 */

export async function ensureWebCryptoSubtle(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (globalThis.crypto?.subtle) return;

  // webcrypto-liner 的 index.d.ts 把 `Crypto` 仅声明为类型别名，但实际 module 构建
  // （见 vite.config.ts 的 alias）导出的是可 new 的构造函数，故通过命名空间转型取用。
  const webcryptoLiner = await import('webcrypto-liner');
  const LinerCrypto = (webcryptoLiner as unknown as { Crypto: new () => Crypto }).Crypto;

  if (typeof globalThis.crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', {
      value: new LinerCrypto(),
      configurable: true,
    });
  } else if (!globalThis.crypto.subtle) {
    // 用 defineProperty 定义实例 own 属性，绕过 Crypto.prototype 上只读的 subtle getter。
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: new LinerCrypto().subtle,
      configurable: true,
    });
  }
}
