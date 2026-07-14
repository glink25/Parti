import { WORLD_WIDTH } from '../game/contracts';

export type PosePacket = { playerId: string; sequence: number; x: number; y: number; vy: number; direction: number; sentAt: number };
export type RemotePose = { x: number; y: number; targetX: number; targetY: number; vx: number; vy: number; sequence: number; receivedAt: number };

export function createRemotePose(x: number, y: number): RemotePose { return { x, y, targetX: x, targetY: y, vx: 0, vy: 0, sequence: -1, receivedAt: 0 }; }

export function acceptPose(current: RemotePose, packet: PosePacket, receivedAt: number) {
  if (!Number.isInteger(packet.sequence) || packet.sequence <= current.sequence) return false;
  current.sequence = packet.sequence; current.targetX = packet.x; current.targetY = packet.y; current.vx = packet.direction * 420; current.vy = packet.vy; current.receivedAt = receivedAt; return true;
}

export function advanceRemotePose(current: RemotePose, now: number, dt: number) {
  const extrapolation = Math.min(180, Math.max(0, now - current.receivedAt)) / 1000;
  const desiredX = ((current.targetX + current.vx * extrapolation) % WORLD_WIDTH + WORLD_WIDTH) % WORLD_WIDTH;
  const desiredY = current.targetY + current.vy * extrapolation;
  let dx = desiredX - current.x; if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH; if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
  const blend = Math.min(1, dt * 12); current.x = (current.x + dx * blend + WORLD_WIDTH) % WORLD_WIDTH; current.y += (desiredY - current.y) * blend;
}
