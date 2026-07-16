import { describe, expect, it } from 'vitest';
import { renderableClassicStrokes } from './canvas-view';

describe('classic remote canvas snapshot fallback', () => {
  it('renders the cumulative path even when the remote receives no points events', () => {
    const snapshot = { id: 'live', tool: 'pen' as const, color: '#000', size: 4, points: [{ x: 0, y: 0 }, { x: .25, y: .25 }, { x: .5, y: .5 }, { x: .75, y: .75 }, { x: 1, y: 1 }] };
    const remote = renderableClassicStrokes([], snapshot, false);
    expect(remote).toHaveLength(1);
    expect(remote[0].points).toHaveLength(5);
    expect(renderableClassicStrokes([], snapshot, true)).toHaveLength(0);
  });
});
