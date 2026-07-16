import { describe, expect, it } from 'vitest';
import { comparableGuess, nextRelayPhase, relayTaskKind, scoreForRemaining } from './game-logic';

describe('game logic', () => {
  it('normalizes guesses and scores exact time bands', () => { expect(comparableGuess('  红，绿 灯！ ')).toBe('红绿灯'); expect([60_001, 60_000, 35_001, 35_000, 15_001, 15_000].map(scoreForRemaining)).toEqual([20, 15, 15, 10, 10, 5]); });
  for (const count of [2, 3, 4, 5, 8]) it(`${count} players always end in a final guess`, () => { const tasks = Array.from({ length: count - 1 }, (_, i) => relayTaskKind(count, i + 1)); expect(tasks.at(-1)).toBe('final-guess'); expect(tasks.slice(0, -1).every((task) => task === 'guess')).toBe(true); expect(nextRelayPhase(count, count - 1)).toBe('reveal'); });
});
