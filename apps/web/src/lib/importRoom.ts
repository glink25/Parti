/** 从 ZIP 文件或 GitHub 地址导入房间模版。 */
import {
  GitHubSourceClient,
  RoomSourceError,
  buildRoomPackageInput,
  collectRoomPackageFiles,
  resolveGitHubImport,
  resolveRoomPackageFiles,
  unzipRoomPackage as unzipSourcePackage,
  type RoomSourceErrorCode,
} from '@parti/room-source';
import type { RoomPackageInput } from '@parti/room-packager';
import { saveImportedTemplate } from './templates';

export { RoomSourceError as ImportRoomError };
export type ImportRoomErrorCode = RoomSourceErrorCode;

/** 由已定位到包根目录的一组文件构造并校验 RoomPackageInput。 */
export async function buildPackageInputFromFiles(
  files: Record<string, Uint8Array>,
): Promise<RoomPackageInput> {
  return buildRoomPackageInput(files);
}

/**
 * 解包并定位 ZIP 中第一个完整房间包，返回以该包目录为根的文件映射。
 * 多层包裹目录、无效浅层 manifest 与不完整入口均使用共享候选规则处理。
 */
export async function unzipRoomPackage(
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<Record<string, Uint8Array>> {
  const archiveFiles = await unzipSourcePackage(data);
  const paths = Object.keys(archiveFiles);
  const { candidate } = await resolveRoomPackageFiles(paths, async (path) => archiveFiles[path]);
  return collectRoomPackageFiles(paths, candidate, async (path) => archiveFiles[path]);
}

/** 从 ZIP 导入并返回保存后的模版 id。 */
export async function importRoomFromZip(file: File): Promise<string> {
  const files = await unzipRoomPackage(file);
  const input = await buildRoomPackageInput(files);
  return saveImportedTemplate(input, { type: 'zip', ref: file.name });
}

/**
 * 从 GitHub 仓库、tree 或 blob 地址导入。仓库文件由共享 GitHub source resolver
 * 定位和下载；若只能找到 release ZIP，会抛出带 releaseUrl 的人工降级错误。
 */
export async function importRoomFromGitHub(url: string): Promise<string> {
  const resolved = await resolveGitHubImport(url, new GitHubSourceClient());
  return saveImportedTemplate(resolved.input, { type: 'github', ref: url });
}

/** 类型守卫，供 UI 展示 release ZIP 人工下载入口。 */
export function releaseFallbackFromError(reason: unknown): string | undefined {
  return reason instanceof RoomSourceError && reason.code === 'RELEASE_MANUAL_REQUIRED'
    ? reason.releaseUrl
    : undefined;
}
