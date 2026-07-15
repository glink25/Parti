import { describe, expect, it } from 'vitest';
import { MidnightWagerAnimationQueue } from './MidnightWagerAnimationQueue';

describe('MidnightWagerAnimationQueue', () => {
  it('deduplicates server actions and advances deterministically', () => {
    const queue = new MidnightWagerAnimationQueue();
    expect(queue.enqueue({ id: 'reveal:1', kind: 'reveal', duration: 800 })).toBe(true);
    expect(queue.enqueue({ id: 'reveal:1', kind: 'reveal', duration: 800 })).toBe(false);
    expect(queue.update(100)?.progress).toBe(0);
    expect(queue.update(500)?.progress).toBe(.5);
    expect(queue.update(900)).toBeNull();
  });
});
