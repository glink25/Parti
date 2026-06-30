/**
 * 官方示例房间注册表（MVP 无后端，静态托管于 public/rooms/）。
 * 后续会被 Room Registry / 大厅服务替代 (§4.1)。
 */
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
