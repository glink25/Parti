/** 准备态自定义 Package 存储。内置模板只由 rooms.ts 从静态目录加载。 */
import { createPackage, type RoomPackageInput } from '@parti/room-packager';
import { rooms as registry } from 'virtual:room-registry';
import { getDb, type CustomPackageRecord } from './db';
import { createDraftId } from './ids';
import { isImportedTemplateSource } from './templateSources';

const BUILTIN_IDS = new Set(registry.map(({ dir, manifest }) => manifest.id ?? dir));

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  descriptionFallback?: 'importedTemplate';
  source: CustomPackageRecord['source'];
  tags: string[];
  imported: boolean;
}

export async function listImportedTemplates(): Promise<TemplateMeta[]> {
  const all = await (await getDb()).getAll('customPackages');
  return all.map((item) => ({
    id: item.id,
    name: item.manifest.name ?? item.id,
    description: item.manifest.description ?? '',
    ...(item.manifest.description ? {} : { descriptionFallback: 'importedTemplate' as const }),
    source: item.source,
    tags: item.manifest.tags ?? [],
    imported: isImportedTemplateSource(item.source),
  }));
}

export async function getTemplatePackage(id: string): Promise<RoomPackageInput | undefined> {
  const record = await (await getDb()).get('customPackages', id);
  return record ? { manifest: record.manifest, files: record.files } : undefined;
}

async function uniqueId(preferred: string): Promise<string> {
  const db = await getDb();
  if (preferred && !BUILTIN_IDS.has(preferred) && !(await db.get('customPackages', preferred))) {
    return preferred;
  }
  let id = createDraftId(preferred || 'package');
  while (BUILTIN_IDS.has(id) || await db.get('customPackages', id)) id = createDraftId(preferred || 'package');
  return id;
}

export async function prepareCustomPackageRecord(
  input: RoomPackageInput,
  source: CustomPackageRecord['source'],
): Promise<CustomPackageRecord> {
  const pkg = await createPackage(input);
  const id = await uniqueId(pkg.manifest.id);
  const normalized = await createPackage({ manifest: { ...pkg.manifest, id }, files: pkg.files });
  return { id, manifest: normalized.manifest, files: normalized.files, source, createdAt: Date.now() };
}

export async function saveCustomPackage(
  input: RoomPackageInput,
  source: CustomPackageRecord['source'],
): Promise<string> {
  const record = await prepareCustomPackageRecord(input, source);
  await (await getDb()).put('customPackages', record);
  return record.id;
}

export const saveImportedTemplate = saveCustomPackage;

export async function deleteImportedTemplate(id: string): Promise<void> {
  await (await getDb()).delete('customPackages', id);
}

export async function getUsageCounts(): Promise<Record<string, number>> {
  const all = await (await getDb()).getAll('usage');
  return Object.fromEntries(all.map((item) => [item.id, item.count]));
}
