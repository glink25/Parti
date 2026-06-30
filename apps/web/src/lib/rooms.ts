/**
 * 官方示例房间注册表（MVP 无后端，静态托管于 public/rooms/）。
 * 后续会被 Room Registry / 大厅服务替代 (§4.1)。
 */
import {
  createPackage,
  loadPackageFromUrl,
  type RoomPackage,
} from '@parti/room-packager';
import { getCustomRoom } from './customRooms.js';

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
 * 统一解析房间包：官方房间从静态 URL 加载，自定义房间从 localStorage 重建。
 * host / 本地预览侧据此拿到内存中的 RoomPackage（含 packageHash 与全部文件）。
 * 加入者不走这里——其包经 fetchPackageOverPeer 从 host 点对点取得。
 */
export async function resolvePackage(id: string): Promise<RoomPackage> {
  const official = findRoom(id);
  if (official) return loadPackageFromUrl(official.baseUrl);

  const custom = getCustomRoom(id);
  if (custom) return createPackage(custom);

  throw new Error(`未知房间: ${id}`);
}
