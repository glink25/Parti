/**
 * 沙箱 iframe 内注入的全局 `parti` 的类型声明（见 docs/client-api.md）。
 */

interface Parti {
  readonly playerId: string | null;
  getState(): unknown;
  onState(handler: (state: unknown) => void): () => void;
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  leave(): void;
  log(...args: unknown[]): void;
}

declare const parti: Parti;
