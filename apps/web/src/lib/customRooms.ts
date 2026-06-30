/**
 * 自定义房间存储 —— 创作者用 localStorage 保存自己的 Room Package 草稿/发布。
 *
 * MVP 无后端 Room Registry (§4.1)，自定义房间以 RoomPackageInput（manifest +
 * 文件文本）持久化在本地，按 manifest.id 索引。host/本地预览侧据此重建 package
 * （刷新后仍可解析，配合 PeerRoomSession 的会话恢复）。
 */
import {
  validateManifest,
  type RoomManifest,
  type RoomPackageInput,
} from '@parti/room-packager';

const STORAGE_KEY = 'parti.customRooms.v1';

/** 大厅展示用的轻量条目（从已存包派生）。 */
export interface CustomRoomEntry {
  id: string;
  name: string;
  description: string;
}

type Stored = Record<string, RoomPackageInput>;

function readAll(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeAll(rooms: Stored): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

/** 列出全部自定义房间（用于大厅）。 */
export function listCustomRooms(): CustomRoomEntry[] {
  const rooms = readAll();
  return Object.values(rooms).map((input) => {
    const m = input.manifest as Partial<RoomManifest>;
    return {
      id: String(m.id ?? ''),
      name: String(m.name ?? m.id ?? '未命名房间'),
      description: m.description ?? '自定义房间',
    };
  });
}

/** 取某自定义房间的包输入（manifest + 文件）。 */
export function getCustomRoom(id: string): RoomPackageInput | undefined {
  return readAll()[id];
}

/**
 * 保存一个自定义房间。校验 manifest 合法（抛 ManifestError），以 manifest.id 为 key。
 * 返回房间 id 以便跳转。
 */
export function saveCustomRoom(input: RoomPackageInput): string {
  const manifest = validateManifest(input.manifest);
  const rooms = readAll();
  rooms[manifest.id] = input;
  writeAll(rooms);
  return manifest.id;
}

export function deleteCustomRoom(id: string): void {
  const rooms = readAll();
  delete rooms[id];
  writeAll(rooms);
}
