import { describe, expect, it } from 'vitest';
import { acceptRemoteFrame, needsHardCorrection, remotePosition } from './remoteMotion';

const frame = (sequence: number, sentAt: number, x: number) => ({ playerId: 'p2', sequence, sentAt, position: { x, y: 0 }, aim: { x: 1, y: 0 } });
describe('remote player motion', () => {
  it('ignores stale pose frames', () => { const current = acceptRemoteFrame(undefined, frame(2, 20, 20), 100); expect(acceptRemoteFrame(current, frame(1, 10, 10), 110)).toBe(current); });
  it('interpolates monotonically without snapshot-style rewinds', () => { let motion = acceptRemoteFrame(undefined, frame(1, 0, 0), 0); motion = acceptRemoteFrame(motion, frame(2, 64, 64), 64); const samples = [64, 74, 89, 114].map((now) => remotePosition(motion, now).x); expect(samples).toEqual([...samples].sort((a, b) => a - b)); expect(samples.at(-1)).toBeGreaterThanOrEqual(64); });
  it('only hard-corrects large authority differences', () => { expect(needsHardCorrection({ x: 100, y: 0 }, { x: 120, y: 0 })).toBe(false); expect(needsHardCorrection({ x: 100, y: 0 }, { x: 400, y: 0 })).toBe(true); });
});
