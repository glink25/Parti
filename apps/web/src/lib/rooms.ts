/** 准备态 Package 来源：内置模板走静态目录，自定义模板走 IndexedDB。 */
import { createPackage, loadPackageFromUrl, type RoomPackage } from '@parti/room-packager';
import { getTemplatePackage, getUsageCounts, listImportedTemplates } from './templates';
import { rooms as registry } from 'virtual:room-registry';

export interface RoomEntry {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  cover?: string;
  files: string[];
}

function resolveCover(baseUrl: string, cover?: string): string | undefined {
  if (!cover) return undefined;
  if (/^(https?:)?\/\//.test(cover) || cover.startsWith('/')) return cover;
  return `${baseUrl}/${cover}`;
}

export const ROOMS: RoomEntry[] = registry.map(({ dir, manifest, files }) => {
  const baseUrl = `/rooms/${dir}`;
  return {
    id: manifest.id ?? dir,
    name: manifest.name ?? dir,
    description: manifest.description ?? '',
    baseUrl,
    cover: resolveCover(baseUrl, manifest.cover),
    files,
  };
}).sort((a, b) => a.id.localeCompare(b.id));

export function findRoom(id: string): RoomEntry | undefined {
  return ROOMS.find((room) => room.id === id);
}

export async function loadPackageSource(sourceId: string): Promise<RoomPackage> {
  const builtin = findRoom(sourceId);
  if (builtin) return loadPackageFromUrl(builtin.baseUrl, builtin.files);
  const input = await getTemplatePackage(sourceId);
  if (!input) throw new PackageSourceNotFoundError(sourceId);
  return createPackage(input);
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
}

export async function listPackageSources(): Promise<TemplateListEntry[]> {
  const [custom, usage] = await Promise.all([listImportedTemplates(), getUsageCounts()]);
  return [
    ...ROOMS.map((room) => ({
      id: room.id, name: room.name, description: room.description, cover: room.cover,
      removable: false, usageCount: usage[room.id] ?? 0,
    })),
    ...custom.map((item) => ({
      id: item.id, name: item.name, description: item.description,
      ...(item.descriptionFallback ? { descriptionFallback: item.descriptionFallback } : {}),
      removable: true, usageCount: usage[item.id] ?? 0,
    })),
  ].sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
}

export const getTemplateList = listPackageSources;
