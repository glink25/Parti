/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOBBY_SERVICE_URL?: string;
  readonly VITE_COMMON_SUPABASE_URL?: string;
  readonly VITE_COMMON_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:room-registry' {
  import type { RoomManifest } from '@parti/room-packager';
  /** public/rooms/ 下的内置模板（目录名 + 其 parti.room.json），由 vite 插件生成。 */
  export const rooms: { dir: string; manifest: RoomManifest; files: string[]; defaultOrderIndex: number }[];
}
