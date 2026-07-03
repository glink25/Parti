/** Room Manifest (parti.room.json) 类型与校验 (GOAL.md §4.3, §14) */

export type SyncMode = 'snapshot' | 'patch';
export type StoragePermission = 'none' | 'session' | 'local';
export type PackageMode = 'blob' | 'filesystem';
export type SensorPermission = 'accelerometer' | 'gyroscope' | 'magnetometer';

export interface RoomManifest {
  partiVersion: string;
  protocolVersion: number;
  id: string;
  name: string;
  version: string;
  packageMode: PackageMode;
  description?: string;
  /** 模板封面图，相对房间目录的路径（如 "cover.png"）或绝对 URL；缺省时 UI 回退渐变占位 */
  cover?: string;
  author?: { name?: string };
  entry: {
    ui: string;
    worker: string;
    client?: string;
    style?: string;
  };
  room?: {
    minPlayers?: number;
    maxPlayers?: number;
    allowSpectators?: boolean;
  };
  sync?: {
    mode?: SyncMode;
    snapshotInterval?: number;
  };
  permissions?: {
    network?: boolean;
    storage?: StoragePermission;
    camera?: boolean;
    microphone?: boolean;
    clipboard?: boolean;
    sensors?: SensorPermission[];
  };
  actions?: Record<string, { payload?: string }>;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

/** 校验 manifest 必填字段；不合法时抛 ManifestError。 */
export function validateManifest(input: unknown): RoomManifest {
  if (!input || typeof input !== 'object') {
    throw new ManifestError('manifest 必须是对象');
  }
  const m = input as Record<string, unknown>;
  requireString(m, 'id');
  requireString(m, 'name');
  requireString(m, 'version');
  requireString(m, 'partiVersion');
  if (m.packageMode !== 'blob' && m.packageMode !== 'filesystem') {
    throw new ManifestError('manifest.packageMode 必须是 blob 或 filesystem');
  }
  if (typeof m.protocolVersion !== 'number') {
    throw new ManifestError('manifest.protocolVersion 必须是数字');
  }
  const entry = m.entry as Record<string, unknown> | undefined;
  if (!entry || typeof entry.ui !== 'string' || typeof entry.worker !== 'string') {
    throw new ManifestError('manifest.entry 必须包含 ui 与 worker');
  }
  const permissions = m.permissions as Record<string, unknown> | undefined;
  if (permissions?.sensors !== undefined) {
    if (!Array.isArray(permissions.sensors)) {
      throw new ManifestError('manifest.permissions.sensors 必须是数组');
    }
    const allowed = new Set<SensorPermission>(['accelerometer', 'gyroscope', 'magnetometer']);
    const seen = new Set<string>();
    for (const sensor of permissions.sensors) {
      if (typeof sensor !== 'string' || !allowed.has(sensor as SensorPermission)) {
        throw new ManifestError(`manifest.permissions.sensors 包含未知传感器: ${String(sensor)}`);
      }
      if (seen.has(sensor)) {
        throw new ManifestError(`manifest.permissions.sensors 包含重复项: ${sensor}`);
      }
      seen.add(sensor);
    }
  }
  return m as unknown as RoomManifest;
}

function requireString(m: Record<string, unknown>, key: string): void {
  if (typeof m[key] !== 'string' || (m[key] as string).length === 0) {
    throw new ManifestError(`manifest.${key} 缺失或非字符串`);
  }
}
