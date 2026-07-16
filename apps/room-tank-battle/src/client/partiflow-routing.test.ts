import { describe, expect, it } from 'vitest';
import { createGameRuntime, createPartiSyncPlugin } from '@parti/flow';
import { tankBattleDefinition } from '../game/definition';
import { createPlayer, initialState } from '../game/rules';

describe('PartiFlow lobby transport', () => {
  it('wraps ready intent in the PartiFlow protocol action', () => {
    const snapshot = initialState();
    snapshot.hostId = 'p1';
    snapshot.players.p1 = createPlayer('p1', 'Player 1', 0);
    const sent: Array<{ type: string; payload: unknown }> = [];
    const parti = {
      playerId: 'p1',
      getState: () => snapshot,
      onState(handler: (state: unknown) => void) { handler(snapshot); return () => {}; },
      onEvent: () => () => {},
      action(type: string, payload?: unknown) { sent.push({ type, payload }); return Promise.resolve({ ok: true as const }); },
      ready() {}, leave() {}, log() {},
    };
    const game = createGameRuntime(tankBattleDefinition, { role: 'client', playerId: 'p1' });
    game.use(createPartiSyncPlugin(parti));

    game.action('lobby.ready', { ready: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('lobby.ready');
    expect(sent[0].payload).toMatchObject({ __partiflow: expect.objectContaining({ type: 'lobby.ready' }) });
    game.dispose();
  });
});
