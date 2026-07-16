import { describe, expect, it } from 'vitest';
import { acceptStrokeUpdate, createStrokeId, createStrokeUpdateLedger, shouldSendStrokeUpdate, STROKE_SYNC_MS } from './stroke-update';

const stroke = (points: number) => ({ id: 's', tool: 'pen' as const, color: '#000', size: 4, points: Array.from({ length: points }, (_, i) => ({ x: i / Math.max(1, points - 1), y: .5 })) });

describe('whole-stroke update protocol', () => {
  it('creates a stroke id accepted by the worker length constraint', () => {
    const id = createStrokeId(1_725_000_000_000, 0.123456789);
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(48);
  });
  it('accepts cumulative snapshots and finalizes once', () => { const ledger = createStrokeUpdateLedger(); expect(acceptStrokeUpdate(ledger, { stroke: stroke(2), updateSeq: 0, complete: false })).toBe(true); expect(acceptStrokeUpdate(ledger, { stroke: stroke(8), updateSeq: 1, complete: false })).toBe(true); expect(acceptStrokeUpdate(ledger, { stroke: stroke(12), updateSeq: 2, complete: true })).toBe(true); expect(acceptStrokeUpdate(ledger, { stroke: stroke(5), updateSeq: 3, complete: false })).toBe(false); });
  it('rejects duplicate, stale, and competing updates', () => { const ledger = createStrokeUpdateLedger(); expect(acceptStrokeUpdate(ledger, { stroke: stroke(2), updateSeq: 2, complete: false })).toBe(true); expect(acceptStrokeUpdate(ledger, { stroke: stroke(3), updateSeq: 2, complete: false })).toBe(false); expect(acceptStrokeUpdate(ledger, { stroke: { ...stroke(3), id: 'other' }, updateSeq: 3, complete: false })).toBe(false); });
  it('sends changed drafts every 300ms and always sends the final version', () => { expect(STROKE_SYNC_MS).toBe(300); expect(shouldSendStrokeUpdate(2, 2, false)).toBe(false); expect(shouldSendStrokeUpdate(2, 3, false)).toBe(true); expect(shouldSendStrokeUpdate(3, 3, true)).toBe(true); });
});
