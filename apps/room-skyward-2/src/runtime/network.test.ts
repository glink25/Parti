import { describe, expect, it } from 'vitest';
import { acceptPose, advanceRemotePose, createRemotePose } from './network';

describe('client-authoritative pose stream', () => {
  it('drops duplicate and out-of-order packets', () => {
    const pose = createRemotePose(100, 100); expect(acceptPose(pose, { playerId: 'p', sequence: 2, x: 200, y: 220, vy: 10, direction: 1, sentAt: 0 }, 100)).toBe(true);
    expect(acceptPose(pose, { playerId: 'p', sequence: 1, x: 0, y: 0, vy: 0, direction: 0, sentAt: 0 }, 110)).toBe(false); expect(pose.targetX).toBe(200);
  });
  it('limits extrapolation and then settles instead of running forever', () => {
    const pose = createRemotePose(100, 100); acceptPose(pose, { playerId: 'p', sequence: 1, x: 100, y: 100, vy: 100, direction: 1, sentAt: 0 }, 0);
    for (let i = 0; i < 100; i += 1) advanceRemotePose(pose, 5000, .016);
    expect(pose.x).toBeCloseTo(175.6, 1); expect(pose.y).toBeCloseTo(118, 1);
  });
});
