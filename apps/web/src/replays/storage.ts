import { openDB, type DBSchema } from 'idb';
import type { ReplayPackageRecord, ReplayRecord } from './types.js';

interface ReplayDB extends DBSchema {
  replays: {
    key: string;
    value: ReplayRecord;
    indexes: { 'by-started-at': number };
  };
  packages: { key: string; value: ReplayPackageRecord };
}

const dbPromise = openDB<ReplayDB>('parti-replays', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 2) {
      for (const name of ['replays', 'packages'] as const) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      }
    }
    const replays = db.createObjectStore('replays', { keyPath: 'id' });
    replays.createIndex('by-started-at', 'startedAt');
    db.createObjectStore('packages', { keyPath: 'hash' });
  },
});

export async function putReplay(record: ReplayRecord): Promise<void> {
  await (await dbPromise).put('replays', record);
}

export async function getReplay(id: string): Promise<ReplayRecord | undefined> {
  return (await dbPromise).get('replays', id);
}

export async function listReplays(): Promise<ReplayRecord[]> {
  const db = await dbPromise;
  const records = await db.getAllFromIndex('replays', 'by-started-at');
  for (const record of records) {
    if (record.status === 'recording' && sessionStorage.getItem(`parti:replay-recording:${record.roomId}`) !== record.id) {
      record.status = 'interrupted';
      record.endedAt = record.updatedAt;
      await db.put('replays', record);
    }
  }
  return records.reverse();
}

export async function deleteReplay(id: string): Promise<void> {
  const db = await dbPromise;
  const record = await db.get('replays', id);
  if (!record) return;
  await db.delete('replays', id);
  const remaining = await db.getAll('replays');
  if (!remaining.some((item) => item.packageHash === record.packageHash)) {
    await db.delete('packages', record.packageHash);
  }
}

export async function putReplayPackage(record: ReplayPackageRecord): Promise<void> {
  await (await dbPromise).put('packages', record);
}

export async function getReplayPackage(hash: string): Promise<ReplayPackageRecord | undefined> {
  return (await dbPromise).get('packages', hash);
}
