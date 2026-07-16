/** 准备态 Package 来源：内置模板走静态目录，自定义模板走 IndexedDB。 */
import { createPackage, loadPackageFromUrl, type RoomManifest, type RoomPackage } from '@parti/room-packager';
import { getTemplatePackage, getUsageCounts, listImportedTemplates } from './templates';
import { rooms as registry } from 'virtual:room-registry';

export interface RoomEntry {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  cover?: string;
  files: string[];
  tags: string[];
  templateOrder?: number;
  defaultOrderIndex: number;
}

function resolveCover(baseUrl: string, cover?: string): string | undefined {
  if (!cover) return undefined;
  if (/^(https?:)?\/\//.test(cover) || cover.startsWith('/')) return cover;
  return `${baseUrl}/${cover}`;
}

function readTemplateOrder(manifest: RoomManifest): number | undefined {
  const value = (manifest as RoomManifest & { _template_order?: unknown })._template_order;
  return typeof value === 'number' ? value : undefined;
}

export const ROOMS: RoomEntry[] = registry.map(({ dir, manifest, files, defaultOrderIndex }) => {
  const baseUrl = `/rooms/${dir}`;
  return {
    id: manifest.id ?? dir,
    name: manifest.name ?? dir,
    description: manifest.description ?? '',
    baseUrl,
    cover: resolveCover(baseUrl, manifest.cover),
    files,
    tags: manifest.tags ?? [],
    templateOrder: readTemplateOrder(manifest),
    defaultOrderIndex,
  };
});

export function findRoom(id: string): RoomEntry | undefined {
  return ROOMS.find((room) => room.id === id);
}

export async function loadPackageSource(sourceId: string): Promise<RoomPackage> {
  return loadPackageSourceWithProgress(sourceId);
}

export async function loadPackageSourceWithProgress(
  sourceId: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<RoomPackage> {
  const builtin = findRoom(sourceId);
  if (builtin) {
    return loadPackageFromUrl(builtin.baseUrl, builtin.files, { onProgress });
  }
  onProgress?.(0, 1);
  const input = await getTemplatePackage(sourceId);
  if (!input) throw new PackageSourceNotFoundError(sourceId);
  const pkg = await createPackage(input);
  onProgress?.(1, 1);
  return pkg;
}

export class PackageSourceNotFoundError extends Error {
  constructor(readonly sourceId: string) {
    super(sourceId);
    this.name = 'PackageSourceNotFoundError';
  }
}

export interface TemplateListEntry {
  id: string;
  name: string;
  description: string;
  descriptionFallback?: 'importedTemplate';
  cover?: string;
  removable: boolean;
  usageCount: number;
  templateOrder?: number;
  defaultOrderIndex?: number;
  tags: string[];
  imported: boolean;
}

/** 使用次数相同时的内置模板默认排序；自定义模板混排时回退 name 比较。 */
export function compareTemplateDefaultOrder(a: TemplateListEntry, b: TemplateListEntry): number {
  if (!a.removable && !b.removable) {
    const orderA = a.templateOrder;
    const orderB = b.templateOrder;
    if (orderA !== undefined && orderB !== undefined) return orderB - orderA;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    const indexA = a.defaultOrderIndex ?? 0;
    const indexB = b.defaultOrderIndex ?? 0;
    if (indexA !== indexB) return indexA - indexB;
    return a.id.localeCompare(b.id);
  }
  return a.name.localeCompare(b.name);
}

export async function listPackageSources(): Promise<TemplateListEntry[]> {
  const [custom, usage] = await Promise.all([listImportedTemplates(), getUsageCounts()]);
  return [
    ...ROOMS.map((room) => ({
      id: room.id, name: room.name, description: room.description, cover: room.cover,
      removable: false, usageCount: usage[room.id] ?? 0,
      templateOrder: room.templateOrder, defaultOrderIndex: room.defaultOrderIndex,
      tags: room.tags,
      imported: false,
    })),
    ...custom.map((item) => ({
      id: item.id, name: item.name, description: item.description,
      ...(item.descriptionFallback ? { descriptionFallback: item.descriptionFallback } : {}),
      removable: true, usageCount: usage[item.id] ?? 0,
      tags: item.tags,
      imported: item.imported,
    })),
  ].sort((a, b) => b.usageCount - a.usageCount || compareTemplateDefaultOrder(a, b));
}

export const getTemplateList = listPackageSources;
