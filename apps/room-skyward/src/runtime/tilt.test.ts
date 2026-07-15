import { describe, expect, it } from 'vitest';
import { requestTiltPermission, TiltController } from './tilt';

describe('TiltController', () => {
  it('calibrates at enable time and recalibrates after screen rotation', () => {
    const tilt = new TiltController();
    tilt.enable();
    tilt.receive({ beta: 0, gamma: 10, screenAngle: 0 });
    tilt.receive({ beta: 0, gamma: 28, screenAngle: 0 });
    expect(tilt.input).toBeGreaterThan(0);
    tilt.receive({ beta: -20, gamma: 0, screenAngle: 90 });
    expect(tilt.input).toBe(0);
  });

  it('lets direct input override tilt without combining velocities', () => {
    const tilt = new TiltController(); tilt.enable();
    tilt.receive({ beta: 0, gamma: 0, screenAngle: 0 });
    tilt.receive({ beta: 0, gamma: 18, screenAngle: 0 });
    tilt.update(.1);
    expect(tilt.update(.1, -1)).toBe(-1);
    expect(tilt.velocity).toBe(0);
  });

  it('requests permission when the HUD toggle needs it', async () => {
    let requests = 0;
    const result = await requestTiltPermission({ getStatus: () => 'needs-permission', requestPermission: async () => { requests += 1; return 'active'; } });
    expect(result).toBe('active'); expect(requests).toBe(1);
    const alreadyActive = await requestTiltPermission({ getStatus: () => 'active', requestPermission: async () => { requests += 1; return 'denied'; } });
    expect(alreadyActive).toBe('active'); expect(requests).toBe(1);
  });
});
