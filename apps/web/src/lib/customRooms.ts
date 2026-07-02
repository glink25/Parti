/** 已开启房间的不可变 Package 快照。 */
import { createPackage, type RoomPackage, type RoomPackageInput } from '@parti/room-packager';
import { getDb, type PackageSourceInfo, type RoomSnapshotRecord } from './db';
import { createDraftId } from './ids';
import { findRoom, loadPackageSource } from './rooms';
import { prepareCustomPackageRecord } from './templates';

export interface CustomRoomEntry {
  id: string;
  name: string;
  description: string;
  target: 'local' | 'peer';
  createdAt: number;
}

type CreateRoomSnapshotOptions =
  | { sourceId: string; target: 'local' | 'peer' }
  | {
      input: RoomPackageInput;
      target: 'local' | 'peer';
      source: { type: 'editor'; basedOn?: string };
    };

export interface CreatedRoomSnapshot {
  roomId: string;
  customPackageId?: string;
}

export async function createRoomSnapshot(
  options: CreateRoomSnapshotOptions,
): Promise<CreatedRoomSnapshot> {
  let sourcePackage: RoomPackage;
  let source: PackageSourceInfo;
  let customRecord;

  if ('sourceId' in options) {
    sourcePackage = await loadPackageSource(options.sourceId);
    source = findRoom(options.sourceId)
      ? { type: 'builtin', id: options.sourceId }
      : { type: 'custom', id: options.sourceId };
  } else {
    customRecord = await prepareCustomPackageRecord(options.input, options.source);
    sourcePackage = await createPackage({ manifest: customRecord.manifest, files: customRecord.files });
    source = { type: 'custom', id: customRecord.id };
  }

  const db = await getDb();
  const prefix = sourcePackage.manifest.id.split('-')[0] || 'room';
  let roomId = createDraftId(prefix);
  while (await db.get('roomSnapshots', roomId)) roomId = createDraftId(prefix);
  const snapshotPackage = await createPackage({
    manifest: { ...sourcePackage.manifest, id: roomId },
    files: sourcePackage.files,
  });
  const snapshot: RoomSnapshotRecord = {
    id: roomId,
    manifest: snapshotPackage.manifest,
    files: snapshotPackage.files,
    packageHash: snapshotPackage.packageHash,
    source,
    target: options.target,
    createdAt: Date.now(),
  };

  const tx = db.transaction(['customPackages', 'roomSnapshots', 'usage'], 'readwrite');
  if (customRecord) await tx.objectStore('customPackages').put(customRecord);
  await tx.objectStore('roomSnapshots').put(snapshot);
  const usage = await tx.objectStore('usage').get(source.id);
  await tx.objectStore('usage').put({ id: source.id, count: (usage?.count ?? 0) + 1 });
  await tx.done;
  return { roomId, ...(customRecord ? { customPackageId: customRecord.id } : {}) };
}

export async function loadRoomSnapshot(roomId: string): Promise<RoomPackage> {
  const record = await (await getDb()).get('roomSnapshots', roomId);
  if (!record) throw new RoomSnapshotNotFoundError(roomId);
  return { manifest: record.manifest, files: record.files, packageHash: record.packageHash };
}

export async function listCustomRooms(): Promise<CustomRoomEntry[]> {
  const all = await (await getDb()).getAll('roomSnapshots');
  return all.map((room) => ({
    id: room.id,
    name: room.manifest.name,
    description: room.manifest.description ?? '',
    target: room.target,
    createdAt: room.createdAt,
  }));
}

export async function deleteRoomSnapshot(roomId: string): Promise<void> {
  await (await getDb()).delete('roomSnapshots', roomId);
}

export const deleteCustomRoom = deleteRoomSnapshot;

export class RoomSnapshotNotFoundError extends Error {
  constructor(readonly roomId: string) {
    super(roomId);
    this.name = 'RoomSnapshotNotFoundError';
  }
}
