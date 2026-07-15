import { describe, expect, it } from 'vitest';
import { MahjongAnimationQueue } from './MahjongAnimationQueue';

describe('MahjongAnimationQueue', () => {
  it('plays in order and rejects duplicate action ids', () => {
    const queue = new MahjongAnimationQueue();
    expect(queue.enqueue({ id: 'a', kind: 'discard', duration: 100, blocking: true })).toBe(true);
    expect(queue.enqueue({ id: 'a', kind: 'discard', duration: 100 })).toBe(false);
    queue.enqueue({ id: 'b', kind: 'peng', duration: 200 });
    expect(queue.update(0)?.id).toBe('a');
    expect(queue.update(50)?.progress).toBe(.5);
    expect(queue.update(100)?.id).toBe('b');
    expect(queue.isInputBlocked()).toBe(false);
  });

  it('can skip stale presentation work', () => {
    const queue = new MahjongAnimationQueue();
    queue.enqueue({ id: 'a', kind: 'deal', duration: 900 });
    queue.update(0); queue.skipToLatest();
    expect(queue.update(1)).toBeNull();
  });
});
