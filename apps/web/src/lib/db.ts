/**
 * 本地 IndexedDB 句柄。
 *
 * 三个 object store：
 * - templates：房间包源（manifest + files），唯一存完整内容处。listed=true 进选择列表
 *   （zip/github 导入），listed=false 为派生包（空白/编辑后产生的一次性包，不进列表）。
 * - rooms：roomId → templateId 指针，不存文件。多个 room 可指向同一 template。
 * - usage：templateId → 创建次数（内置 + 导入模版）。
 *
 * 不做任何 localStorage 迁移：全新开始。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RoomManifest } from '@parti/room-packager';

export interface TemplateRecord {
  id: string;
  manifest: RoomManifest;
  files: Record<string, Uint8Array>;
  listed: boolean;
  source?: { type: 'zip' | 'github'; ref?: string };
  createdAt: number;
}

export interface RoomRecord {
  id: string;
  templateId: string;
  createdAt: number;
}

export interface UsageRecord {
  id: string;
  count: number;
}

interface PartiDB extends DBSchema {
  templates: { key: string; value: TemplateRecord };
  rooms: { key: string; value: RoomRecord };
  usage: { key: string; value: UsageRecord };
}

const DB_NAME = 'parti';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<PartiDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<PartiDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PartiDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 2) {
          for (const name of ['templates', 'rooms', 'usage'] as const) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
          }
        }
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('rooms')) {
          db.createObjectStore('rooms', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('usage')) {
          db.createObjectStore('usage', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}
