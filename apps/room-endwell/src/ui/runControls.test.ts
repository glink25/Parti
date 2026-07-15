import { describe, expect, it } from 'vitest';
import { restartControl } from './runControls';

describe('restart control', () => {
  it('is hidden during a run', () => { expect(restartControl({ phase: 'running', hostId: 'p1' }, 'p1')).toMatchObject({ visible: false, enabled: false }); });
  it('lets only the host restart after defeat or victory', () => { for (const phase of ['gameover', 'victory'] as const) { expect(restartControl({ phase, hostId: 'p1' }, 'p1')).toEqual({ visible: true, enabled: true, label: '重新开始游戏' }); expect(restartControl({ phase, hostId: 'p1' }, 'p2')).toEqual({ visible: true, enabled: false, label: '等待房主重新开始' }); } });
});
