import { MOVE_SPEED, orientationAxis, tiltDirection, updateTiltVelocity } from './physics';

export type OrientationSample = { beta: number | null; gamma: number | null; screenAngle: number };

export async function requestTiltPermission(orientation: { getStatus(): string; requestPermission(): Promise<string> }) {
  const status = orientation.getStatus();
  return status === 'active' || status === 'no-data' ? status : orientation.requestPermission();
}

export class TiltController {
  enabled = false;
  input = 0;
  velocity = 0;
  private neutral: number | null = null;
  private filtered = 0;
  private screenAngle: number | null = null;

  enable() { this.enabled = true; this.resetMotion(); }

  disable() { this.enabled = false; this.resetMotion(); }

  receive(data: OrientationSample) {
    if (!this.enabled) return; const axis = orientationAxis(data); if (axis.value == null) return;
    if (this.screenAngle !== axis.angle || this.neutral == null) { this.screenAngle = axis.angle; this.neutral = axis.value; this.filtered = 0; }
    const delta = axis.value - this.neutral; this.filtered += (delta - this.filtered) * .18; this.input = tiltDirection(this.filtered);
  }

  update(dt: number, direct: -1 | 0 | 1 = 0) {
    if (direct) { this.velocity = 0; return direct; }
    if (!this.enabled) { this.velocity = 0; return 0; }
    this.velocity = updateTiltVelocity(this.velocity, this.input, dt);
    return this.velocity / MOVE_SPEED;
  }

  private resetMotion() { this.input = 0; this.velocity = 0; this.neutral = null; this.filtered = 0; this.screenAngle = null; }
}
