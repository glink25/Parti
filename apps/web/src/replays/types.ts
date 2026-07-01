import type { Player, RoomMessage, SnapshotPayload } from '@parti/core';
import type { RoomManifest } from '@parti/room-packager';

export type ReplayStep =
  | { index: number; at: number; kind: 'snapshot'; snapshot: SnapshotPayload }
  | { index: number; at: number; kind: 'action'; playerId: string; action: string; payload: unknown }
  | { index: number; at: number; kind: 'event'; event: string; payload: unknown }
  | { index: number; at: number; kind: 'players'; players: Player[] }
  | { index: number; at: number; kind: 'message'; direction: 'in' | 'out'; message: RoomMessage };

export interface ReplayRecord {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  packageHash: string;
  hostPlayerId: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  status: 'recording' | 'completed' | 'interrupted';
  steps: ReplayStep[];
}

export interface ReplayPackageRecord {
  hash: string;
  packageHash: string;
  manifest: RoomManifest;
  files: Record<string, Uint8Array>;
}
