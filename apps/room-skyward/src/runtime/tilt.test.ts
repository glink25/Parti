import { describe, expect, it } from 'vitest';
import { requestTiltPermission, TILT_CALIBRATION_SAMPLES, TiltController } from './tilt';

const sample = (gamma: number, screenAngle = 0) => ({ beta: 0, gamma, screenAngle });
function calibrate(tilt: TiltController, value = 0) { for (let i = 0; i < TILT_CALIBRATION_SAMPLES; i += 1) tilt.receive(sample(value)); }

describe('TiltController', () => {
  it('stays still while averaging ten calibration samples', () => {
    const tilt = new TiltController(); tilt.enable();
    for (let i = 0; i < TILT_CALIBRATION_SAMPLES - 1; i += 1) { tilt.receive(sample(i % 2 ? 11 : 9)); expect(tilt.update()).toBe(0); }
    tilt.receive(sample(11)); expect(tilt.update()).toBe(0);
    tilt.receive(sample(10)); expect(tilt.update()).toBe(0);
  });

  it('ignores invalid readings instead of counting them toward calibration', () => {
    const tilt = new TiltController(); tilt.enable();
    tilt.receive(sample(Number.NaN)); tilt.receive(sample(Number.POSITIVE_INFINITY));
    for (let i = 0; i < TILT_CALIBRATION_SAMPLES - 1; i += 1) tilt.receive(sample(0));
    tilt.receive(sample(12)); expect(tilt.update()).toBe(0);
    tilt.receive(sample(24)); expect(tilt.update()).toBe(1);
  });

  it('maps calibrated tilt directly to half and full speed', () => {
    const tilt = new TiltController(); tilt.enable(); calibrate(tilt, 10);
    tilt.receive(sample(18)); expect(tilt.update()).toBe(.5);
    tilt.receive(sample(22)); expect(tilt.update()).toBe(1);
    tilt.receive(sample(2)); expect(tilt.update()).toBe(-.5);
    tilt.receive(sample(-2)); expect(tilt.update()).toBe(-1);
  });

  it('reverses at full speed on the next sensor sample', () => {
    const tilt = new TiltController(); tilt.enable(); calibrate(tilt);
    tilt.receive(sample(-12)); expect(tilt.update()).toBe(-1);
    tilt.receive(sample(12)); expect(tilt.update()).toBe(1);
  });

  it('recenters slow neutral drift without swallowing deliberate tilt', () => {
    const tilt = new TiltController(); tilt.enable(); calibrate(tilt);
    for (let value = 0; value <= 8; value += .01) { tilt.receive(sample(value)); expect(tilt.update()).toBe(0); }
    tilt.disable(); tilt.enable(); calibrate(tilt);
    for (let i = 0; i < 100; i += 1) tilt.receive(sample(12));
    expect(tilt.update()).toBe(1);
    tilt.receive(sample(8)); expect(tilt.update()).toBe(.5);
  });

  it('recalibrates after screen rotation and lets direct input override tilt', () => {
    const tilt = new TiltController(); tilt.enable(); calibrate(tilt);
    tilt.receive(sample(12)); expect(tilt.update()).toBe(1);
    for (let i = 0; i < TILT_CALIBRATION_SAMPLES; i += 1) { tilt.receive({ beta: -20, gamma: 0, screenAngle: 90 }); expect(tilt.update()).toBe(0); }
    tilt.receive({ beta: -32, gamma: 0, screenAngle: 90 }); expect(tilt.update()).toBe(1);
    expect(tilt.update(-1)).toBe(-1);
  });

  it.each([
    { screenAngle: 180, neutral: -20, tilted: -32, direction: -1 },
    { screenAngle: 270, neutral: 20, tilted: 32, direction: 1 },
  ])('recalibrates at $screenAngle degrees', ({ screenAngle, neutral, tilted, direction }) => {
    const tilt = new TiltController(); tilt.enable(); calibrate(tilt);
    for (let i = 0; i < TILT_CALIBRATION_SAMPLES; i += 1) { tilt.receive({ beta: screenAngle === 270 ? neutral : 0, gamma: screenAngle === 180 ? -neutral : 0, screenAngle }); expect(tilt.update()).toBe(0); }
    tilt.receive({ beta: screenAngle === 270 ? tilted : 0, gamma: screenAngle === 180 ? -tilted : 0, screenAngle }); expect(tilt.update()).toBe(direction);
  });

  it('requests permission only when needed', async () => {
    let requests = 0;
    expect(await requestTiltPermission({ getStatus: () => 'needs-permission', requestPermission: async () => { requests += 1; return 'active'; } })).toBe('active');
    expect(await requestTiltPermission({ getStatus: () => 'active', requestPermission: async () => { requests += 1; return 'denied'; } })).toBe('active');
    expect(requests).toBe(1);
  });
});
