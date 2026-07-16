interface PartiApi {
  playerId: string | null;
  getState(): unknown;
  onState(handler: (state: unknown) => void): () => void;
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  leave(): void;
  log(...args: unknown[]): void;
}

declare const parti: PartiApi;
