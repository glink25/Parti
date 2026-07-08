import type { PosePayload, Vec2 } from '../game/contracts';

export type RemotePoseFrame = Omit<PosePayload, 'selectedElements'> & { playerId: string; selectedElements?: PosePayload['selectedElements'] };
export type RemoteMotion = { previous: RemotePoseFrame; current: RemotePoseFrame; receivedAt: number };
export const INTERPOLATION_BUFFER_MS = 50;
export const MAX_EXTRAPOLATION_MS = 100;
export const HARD_CORRECTION_DISTANCE = 180;

export function acceptRemoteFrame(current: RemoteMotion | undefined, frame: RemotePoseFrame, receivedAt: number): RemoteMotion {
  if (current && frame.sequence <= current.current.sequence) return current;
  return { previous: current?.current ?? frame, current: frame, receivedAt };
}
export function remotePosition(motion: RemoteMotion, now: number): Vec2 { const { previous, current, receivedAt } = motion, blend = Math.max(0, Math.min(1, (now - receivedAt) / INTERPOLATION_BUFFER_MS)); let x = previous.position.x + (current.position.x - previous.position.x) * blend, y = previous.position.y + (current.position.y - previous.position.y) * blend; if (blend >= 1) { const age = Math.max(0, Math.min(MAX_EXTRAPOLATION_MS, now - receivedAt - INTERPOLATION_BUFFER_MS)), dt = Math.max(16, current.sentAt - previous.sentAt); x += (current.position.x - previous.position.x) / dt * age; y += (current.position.y - previous.position.y) / dt * age; } return { x, y }; }
export function needsHardCorrection(current: Vec2, authoritative: Vec2) { return Math.hypot(current.x - authoritative.x, current.y - authoritative.y) > HARD_CORRECTION_DISTANCE; }
