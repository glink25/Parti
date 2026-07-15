import { describe, expect, it } from 'vitest';
import { DoudizhuAnimationQueue } from './DoudizhuAnimationQueue';

describe('DoudizhuAnimationQueue', () => {
  it('serializes actions and fast-forwards', () => {
    const queue = new DoudizhuAnimationQueue();
    queue.enqueue({ id: 'deal', kind: 'dealStarted', duration: 1000, blocking: true });
    queue.enqueue({ id: 'bid', kind: 'bidPlaced', duration: 400 });
    expect(queue.update(10)?.kind).toBe('dealStarted');
    expect(queue.isInputBlocked()).toBe(true);
    queue.skipToLatest();
    expect(queue.update(20)).toBeNull();
  });
});
