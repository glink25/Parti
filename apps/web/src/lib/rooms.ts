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
}

export const ROOMS: RoomEntry[] = [
  {
    id: 'counter',
    name: '多人计数器',
    description: '验证 action / snapshot / broadcast / 多玩家加入 (§22.1)',
    baseUrl: '/rooms/counter',
  },
  {
    id: 'guess-word',
    name: '猜词游戏',
    description: '验证 ready / phase / 玩家输入 / 胜负判断 / event (§22.2)',
    baseUrl: '/rooms/guess-word',
  },
];

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
