/**
 * 房间指针存储 —— 一个房间 = roomId → templateId 的指针，不存任何文件。
 *
 * 完整包源只存在 templates 表（见 templates.ts）。host/本地预览侧用 resolvePackage(roomId)
 * 顺指针取到模版包，并在内存里把 manifest.id 覆盖为 roomId（见 rooms.ts），从而：
 * 多个房间复用同一模版、零重复存储，刷新后仍可解析。
 */
import { rooms as registry } from 'virtual:room-registry';
import { getDb } from './db.js';
import { createDraftId } from './ids.js';

/** 大厅/首页展示用的轻量条目。 */
export interface CustomRoomEntry {
  id: string;
  name: string;
  description: string;
}

const BUILTIN = new Map(
  registry.map(({ dir, manifest }) => {
    const m = manifest as { id?: string; name?: string; description?: string };
    return [m.id ?? dir, { name: m.name ?? dir, description: m.description ?? '' }] as const;
  }),
);

async function templateMeta(templateId: string): Promise<{ name: string; description: string }> {
  const builtin = BUILTIN.get(templateId);
  if (builtin) return builtin;
  const db = await getDb();
  const record = await db.get('templates', templateId);
  return {
    name: record?.manifest.name ?? templateId,
    description: record?.manifest.description ?? '自定义房间',
  };
}

/** 新建一个房间指针，返回 roomId。 */
export async function createRoom(templateId: string): Promise<string> {
  const id = createDraftId(templateId.split('-')[0] || 'room');
  const db = await getDb();
  await db.put('rooms', { id, templateId, createdAt: Date.now() });
  return id;
}

export async function getRoomPointer(roomId: string): Promise<{ templateId: string } | undefined> {
  const db = await getDb();
  const record = await db.get('rooms', roomId);
  return record ? { templateId: record.templateId } : undefined;
}

/** 列出全部房间（用于大厅），联表取模版名称/描述。 */
export async function listCustomRooms(): Promise<CustomRoomEntry[]> {
  const db = await getDb();
  const all = await db.getAll('rooms');
  return Promise.all(
    all.map(async (room) => {
      const meta = await templateMeta(room.templateId);
      return { id: room.id, name: meta.name, description: meta.description };
    }),
  );
}

export async function deleteCustomRoom(roomId: string): Promise<void> {
  const db = await getDb();
  await db.delete('rooms', roomId);
}
