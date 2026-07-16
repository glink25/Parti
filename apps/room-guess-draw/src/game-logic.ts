export function normalizeGuess(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function comparableGuess(value: unknown) {
  return normalizeGuess(value).toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()【】\[\]《》<>]/g, '');
}

export function scoreForRemaining(remainingMs: number) {
  if (remainingMs > 60_000) return 20;
  if (remainingMs > 35_000) return 15;
  if (remainingMs > 15_000) return 10;
  return 5;
}

export function relayTaskKind(participantCount: number, step: number): 'guess' | 'final-guess' {
  if (participantCount < 2 || step < 1 || step >= participantCount) throw new RangeError('invalid relay step');
  return step === participantCount - 1 ? 'final-guess' : 'guess';
}

export function nextRelayPhase(participantCount: number, completedGuessStep: number): 'redraw' | 'reveal' {
  return relayTaskKind(participantCount, completedGuessStep) === 'final-guess' ? 'reveal' : 'redraw';
}

