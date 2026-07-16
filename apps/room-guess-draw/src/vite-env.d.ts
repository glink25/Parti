/// <reference types="vite/client" />
interface PartiApi {
  playerId: string | null;
  onState(handler: (state: unknown) => void): () => void;
  onEvent(event: string, handler: (payload: any) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  log(...args: unknown[]): void;
}
declare const parti: PartiApi;
