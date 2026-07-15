import { orientationAxis, TILT_DEAD_ZONE, tiltDirection } from './physics';

export type OrientationSample = { beta: number | null; gamma: number | null; screenAngle: number };
export const TILT_CALIBRATION_SAMPLES = 10;
export const TILT_RECENTER_RATE = .02;

export async function requestTiltPermission(orientation: { getStatus(): string; requestPermission(): Promise<string> }) {
  const status = orientation.getStatus();
  return status === 'active' || status === 'no-data' ? status : orientation.requestPermission();
}

export class TiltController {
  enabled = false;
  input = 0;
  private neutral: number | null = null;
  private screenAngle: number | null = null;
  private calibrationCount = 0;
  private calibrationTotal = 0;

  enable() { this.enabled = true; this.resetMotion(); }

  disable() { this.enabled = false; this.resetMotion(); }

  receive(data: OrientationSample) {
    if (!this.enabled) return; const axis = orientationAxis(data); if (axis.value == null || !Number.isFinite(axis.value)) return;
    if (this.screenAngle !== axis.angle) this.beginCalibration(axis.angle);
    if (this.calibrationCount < TILT_CALIBRATION_SAMPLES) {
      this.calibrationTotal += axis.value; this.calibrationCount += 1; this.input = 0;
      if (this.calibrationCount === TILT_CALIBRATION_SAMPLES) this.neutral = this.calibrationTotal / this.calibrationCount;
      return;
    }
    const delta = axis.value - this.neutral!;
    if (Math.abs(delta) <= TILT_DEAD_ZONE) this.neutral! += delta * TILT_RECENTER_RATE;
    this.input = tiltDirection(delta);
  }

  update(direct: -1 | 0 | 1 = 0) {
    if (direct) return direct;
    return this.enabled ? this.input : 0;
  }

  private beginCalibration(angle: number | null) { this.input = 0; this.neutral = null; this.screenAngle = angle; this.calibrationCount = 0; this.calibrationTotal = 0; }
  private resetMotion() { this.beginCalibration(null); }
}
