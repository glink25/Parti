/**
 * 模版（房间包源）存储 + 使用计数。
 *
 * 所有完整包源都存在 IndexedDB 的 templates 表：
 * - listed=true：zip/github 导入的模版，进创建页的选择列表。
 * - listed=false：派生包（空白起步或编辑器改过内容产生的一次性包），仅供 room 指针引用。
 */
import { validateManifest, type RoomPackageInput } from '@parti/room-packager';
import { rooms as registry } from 'virtual:room-registry';
import { getDb, type TemplateRecord } from './db.js';
import { createDraftId } from './ids.js';

const BUILTIN_IDS = new Set(
  registry.map(({ dir, manifest }) => (manifest as { id?: string }).id ?? dir),
);

/** 选择列表用的轻量模版元信息。 */
export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  source?: TemplateRecord['source'];
}

function toInput(record: TemplateRecord): RoomPackageInput {
  return { manifest: record.manifest, files: record.files };
}

/** 列出可在创建页展示的导入模版（listed=true）。 */
export async function listImportedTemplates(): Promise<TemplateMeta[]> {
  const db = await getDb();
  const all = await db.getAll('templates');
  return all
    .filter((t) => t.listed)
    .map((t) => ({
      id: t.id,
      name: t.manifest.name ?? t.id,
      description: t.manifest.description ?? '导入的房间模版',
      source: t.source,
    }));
}

/** 取任意 template（listed 或派生）的包输入。 */
export async function getTemplatePackage(id: string): Promise<RoomPackageInput | undefined> {
  const db = await getDb();
  const record = await db.get('templates', id);
  return record ? toInput(record) : undefined;
}

async function existsId(id: string): Promise<boolean> {
  if (BUILTIN_IDS.has(id)) return true;
  const db = await getDb();
  return Boolean(await db.get('templates', id));
}

/** 生成一个不与内置/已存模版冲突的 id（必要时基于原 id 派生）。 */
async function uniqueId(preferred: string): Promise<string> {
  if (preferred && !(await existsId(preferred))) return preferred;
  let id = createDraftId(preferred || 'room');
  while (await existsId(id)) id = createDraftId(preferred || 'room');
  return id;
}

async function saveTemplate(
  input: RoomPackageInput,
  listed: boolean,
  source?: TemplateRecord['source'],
): Promise<string> {
  const manifest = validateManifest(input.manifest);
  const id = await uniqueId(manifest.id);
  const record: TemplateRecord = {
    id,
    manifest: { ...manifest, id },
    files: input.files,
    listed,
    source,
    createdAt: Date.now(),
  };
  const db = await getDb();
  await db.put('templates', record);
  return id;
}

/** 保存一个导入模版（进选择列表）。返回最终 id。 */
export function saveImportedTemplate(
  input: RoomPackageInput,
  source: TemplateRecord['source'],
): Promise<string> {
  return saveTemplate(input, true, source);
}

/** 保存一个派生包（不进选择列表）。返回最终 id。 */
export function saveDerivedTemplate(input: RoomPackageInput): Promise<string> {
  return saveTemplate(input, false);
}

export async function deleteImportedTemplate(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('templates', id);
}

/** 模版创建计数 +1（内置/导入均按 templateId 计）。 */
export async function recordTemplateUsage(templateId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('usage', 'readwrite');
  const current = await tx.store.get(templateId);
  await tx.store.put({ id: templateId, count: (current?.count ?? 0) + 1 });
  await tx.done;
}

export async function getUsageCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const all = await db.getAll('usage');
  return Object.fromEntries(all.map((u) => [u.id, u.count]));
}
