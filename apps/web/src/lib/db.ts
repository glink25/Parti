/** Room Package 两阶段存储。内置模板不进入此数据库。 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RoomManifest } from '@parti/room-packager';

export type PackageSourceInfo =
  | { type: 'zip'; ref?: string }
  | { type: 'github'; ref?: string }
  | { type: 'market'; ref?: string }
  | { type: 'editor'; basedOn?: string }
  | { type: 'builtin'; id: string }
  | { type: 'custom'; id: string };

export interface CustomPackageRecord {
  id: string;
  manifest: RoomManifest;
  files: Record<string, Uint8Array>;
  source: Exclude<PackageSourceInfo, { type: 'builtin' } | { type: 'custom' }>;
  createdAt: number;
}

export interface RoomSnapshotRecord {
  id: string;
  manifest: RoomManifest;
  files: Record<string, Uint8Array>;
  packageHash: string;
  source: PackageSourceInfo;
  target: 'local' | 'peer';
  createdAt: number;
}

export interface UsageRecord {
  id: string;
  count: number;
}

interface RoomPackageDB extends DBSchema {
  customPackages: { key: string; value: CustomPackageRecord };
  roomSnapshots: { key: string; value: RoomSnapshotRecord };
  usage: { key: string; value: UsageRecord };
}

export const ROOM_PACKAGE_DB_NAME = 'parti-room-packages-v1';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<RoomPackageDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<RoomPackageDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RoomPackageDB>(ROOM_PACKAGE_DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('customPackages', { keyPath: 'id' });
        db.createObjectStore('roomSnapshots', { keyPath: 'id' });
        db.createObjectStore('usage', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}
