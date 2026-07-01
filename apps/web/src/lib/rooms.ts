/**
 * 官方示例房间注册表（MVP 无后端，静态托管于 public/rooms/）。
 * 后续会被 Room Registry / 大厅服务替代 (§4.1)。
 */
import {
  createPackage,
  loadPackageFromUrl,
  type RoomPackage,
} from '@parti/room-packager';
import { getRoomPointer } from './customRooms.js';
import { getTemplatePackage, getUsageCounts, listImportedTemplates } from './templates.js';

export interface RoomEntry {
  id: string;
  name: string;
  description: string;
  /** 静态包 baseUrl */
  baseUrl: string;
  /** 模板封面图（缺失时 UI 回退渐变占位） */
  cover?: string;
}

/**
 * 内置模板注册表由 vite 插件 `virtual:room-registry` 在构建/开发期扫描 public/rooms/ 生成
 * （见 apps/web/vite.config.ts）。新增模板只需在 public/rooms/ 放一个含 parti.room.json 的
 * 目录，无需改代码。public 文件运行时挂在根路径，故 baseUrl = /rooms/<dir>。
 */
import { rooms as registry } from 'virtual:room-registry';

/** 把 manifest.cover 解析成可直接用于 UI 的 URL（相对房间目录或绝对 URL）。 */
function resolveCover(baseUrl: string, cover?: string): string | undefined {
  if (!cover) return undefined;
  if (/^(https?:)?\/\//.test(cover) || cover.startsWith('/')) return cover;
  return `${baseUrl}/${cover}`;
}

export const ROOMS: RoomEntry[] = registry
  .map(({ dir, manifest }) => {
    const baseUrl = `/rooms/${dir}`;
    return {
      id: manifest.id ?? dir,
      name: manifest.name ?? dir,
      description: manifest.description ?? '',
      baseUrl,
      cover: resolveCover(baseUrl, manifest.cover),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export function findRoom(id: string): RoomEntry | undefined {
  return ROOMS.find((r) => r.id === id);
}

/**
 * 统一解析包：
 * 1) 官方房间 → 静态 URL 加载；
 * 2) room 指针 → 取其模版包，并把 manifest.id 覆盖为 roomId（保证 host 房间身份唯一，
 *    多个房间复用同一模版、零重复存储）；
 * 3) template id（供编辑器按模版加载）→ 直接返回其包。
 * host / 本地预览侧据此拿到内存中的 RoomPackage（含 packageHash 与全部文件）。
 * 加入者不走这里——其包经 fetchPackageOverPeer 从 host 点对点取得。
 */
export async function resolvePackage(id: string): Promise<RoomPackage> {
  const official = findRoom(id);
  if (official) return loadPackageFromUrl(official.baseUrl);

  const pointer = await getRoomPointer(id);
  if (pointer) {
    const tplId = pointer.templateId;
    const officialTpl = findRoom(tplId);
    const base = officialTpl
      ? await loadPackageFromUrl(officialTpl.baseUrl)
      : await createPackageFromTemplate(tplId);
    return createPackage({
      manifest: { ...base.manifest, id },
      files: base.files,
    });
  }

  return createPackageFromTemplate(id);
}

async function createPackageFromTemplate(templateId: string): Promise<RoomPackage> {
  const input = await getTemplatePackage(templateId);
  if (!input) throw new RoomNotFoundError(templateId);
  return createPackage(input);
}

export class RoomNotFoundError extends Error {
  readonly templateId: string;

  constructor(templateId: string) {
    super(templateId);
    this.name = 'RoomNotFoundError';
    this.templateId = templateId;
  }
}

export interface TemplateListEntry {
  id: string;
  name: string;
  description: string;
  descriptionFallback?: 'importedTemplate';
  cover?: string;
  /** 导入模版可删除；内置模版为 false */
  removable: boolean;
  usageCount: number;
}

/**
 * 创建页用的模版列表：内置 + 导入，按创建次数降序（并列按 name）。
 */
export async function getTemplateList(): Promise<TemplateListEntry[]> {
  const [imported, usage] = await Promise.all([listImportedTemplates(), getUsageCounts()]);
  const builtin: TemplateListEntry[] = ROOMS.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    cover: r.cover,
    removable: false,
    usageCount: usage[r.id] ?? 0,
  }));
  const importedEntries: TemplateListEntry[] = imported.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    ...(t.descriptionFallback ? { descriptionFallback: t.descriptionFallback } : {}),
    removable: true,
    usageCount: usage[t.id] ?? 0,
  }));
  return [...builtin, ...importedEntries].sort(
    (a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name),
  );
}
