import { describe, expect, it } from 'vitest';
import { createReplayId } from './replayId.js';

describe('createReplayId', () => {
  it('does not require crypto.randomUUID', () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(createReplayId()).toMatch(/^replay-[0-9a-f-]{36}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
