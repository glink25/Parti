import JSZip from 'jszip';
import {
  createPackage,
  decodeText,
  normalizePackagePath,
  validateManifest,
  type RoomManifest,
  type RoomPackageInput,
} from '@parti/room-packager';

export const ROOM_MANIFEST_NAME = 'parti.room.json';
export const ROOM_RELEASE_ASSET = 'parti.room.zip';

export type RoomSourceErrorCode =
  | 'SOURCE_PATH_INVALID'
  | 'SOURCE_READ_FAILED'
  | 'MANIFEST_NOT_FOUND'
  | 'MANIFEST_INVALID'
  | 'ENTRY_MISSING'
  | 'NO_COMPLETE_PACKAGE'
  | 'ZIP_INVALID'
  | 'GITHUB_URL_INVALID'
  | 'GITHUB_REF_NOT_FOUND'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_TREE_FAILED'
  | 'GITHUB_TREE_TRUNCATED'
  | 'GITHUB_DOWNLOAD_FAILED'
  | 'RELEASE_NOT_FOUND'
  | 'RELEASE_ASSET_MISSING'
  | 'RELEASE_MANUAL_REQUIRED';

export interface PackageCandidateFailure {
  manifestPath: string;
  code: 'MANIFEST_INVALID' | 'ENTRY_MISSING';
  path?: string;
}

export class RoomSourceError extends Error {
  readonly code: RoomSourceErrorCode;
  readonly path?: string;
  readonly status?: number;
  readonly failures?: PackageCandidateFailure[];
  readonly releaseUrl?: string;

  constructor(code: RoomSourceErrorCode, options: {
    path?: string;
    status?: number;
    failures?: PackageCandidateFailure[];
    releaseUrl?: string;
  } = {}) {
    super(code);
    this.name = 'RoomSourceError';
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    if (options.status !== undefined) this.status = options.status;
    if (options.failures !== undefined) this.failures = options.failures;
    if (options.releaseUrl !== undefined) this.releaseUrl = options.releaseUrl;
  }
}

export interface RoomPackageCandidate {
  manifest: RoomManifest;
  manifestPath: string;
  packageDir: string;
}

export type ReadSourceFile = (path: string) => Promise<Uint8Array>;

function depth(path: string): number {
  return path === '.' ? 0 : path.split('/').length;
}

export function normalizeSourceScope(scope: string | undefined): string {
  if (!scope || scope === '.') return '.';
  try {
    return normalizePackagePath(scope.replace(/\/$/, ''));
  } catch {
    throw new RoomSourceError('SOURCE_PATH_INVALID', { path: scope });
  }
}

export function packageEntryPaths(manifest: RoomManifest): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(manifest.entry)) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length === 0) {
      throw new RoomSourceError('SOURCE_PATH_INVALID', { path: `entry.${key}` });
    }
    paths.push(value);
  }
  for (const path of paths) {
    try {
      normalizePackagePath(path);
    } catch {
      throw new RoomSourceError('SOURCE_PATH_INVALID', { path });
    }
  }
  return paths;
}

export function joinSourcePath(dir: string, path: string): string {
  return dir === '.' ? path : `${dir}/${path}`;
}

export function isPathInScope(path: string, scope: string): boolean {
  return scope === '.' || path === scope || path.startsWith(`${scope}/`);
}

export function listManifestCandidates(paths: readonly string[], scope = '.'): string[] {
  const normalizedScope = normalizeSourceScope(scope);
  return paths
    .filter((path) => isPathInScope(path, normalizedScope))
    .filter((path) => path === ROOM_MANIFEST_NAME || path.endsWith(`/${ROOM_MANIFEST_NAME}`))
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

export async function findRoomPackageCandidate(
  paths: readonly string[],
  readFile: ReadSourceFile,
  scope = '.',
): Promise<RoomPackageCandidate> {
  const candidates = listManifestCandidates(paths, scope);
  if (candidates.length === 0) throw new RoomSourceError('MANIFEST_NOT_FOUND');

  const pathSet = new Set(paths);
  const failures: PackageCandidateFailure[] = [];
  for (const manifestPath of candidates) {
    let manifestBytes: Uint8Array;
    try {
      manifestBytes = await readFile(manifestPath);
    } catch (reason) {
      if (reason instanceof RoomSourceError) throw reason;
      throw new RoomSourceError('SOURCE_READ_FAILED', { path: manifestPath });
    }
    let manifest: RoomManifest;
    try {
      manifest = validateManifest(JSON.parse(decodeText(manifestBytes)));
    } catch {
      failures.push({ manifestPath, code: 'MANIFEST_INVALID' });
      continue;
    }

    const packageDir = manifestPath === ROOM_MANIFEST_NAME
      ? '.'
      : manifestPath.slice(0, -(ROOM_MANIFEST_NAME.length + 1));
    let invalidPath: string | undefined;
    try {
      packageEntryPaths(manifest);
    } catch (reason) {
      invalidPath = reason instanceof RoomSourceError ? reason.path : undefined;
    }
    if (invalidPath) {
      failures.push({ manifestPath, code: 'ENTRY_MISSING', path: invalidPath });
      continue;
    }
    const missing = packageEntryPaths(manifest).find((path) => !pathSet.has(joinSourcePath(packageDir, path)));
    if (missing) {
      failures.push({ manifestPath, code: 'ENTRY_MISSING', path: missing });
      continue;
    }
    return { manifest, manifestPath, packageDir };
  }

  throw new RoomSourceError('NO_COMPLETE_PACKAGE', { failures });
}

export async function collectRoomPackageFiles(
  paths: readonly string[],
  candidate: RoomPackageCandidate,
  readFile: ReadSourceFile,
): Promise<Record<string, Uint8Array>> {
  const prefix = candidate.packageDir === '.' ? '' : `${candidate.packageDir}/`;
  const packagePaths = paths.filter((path) => prefix === '' || path.startsWith(prefix));
  const files: Record<string, Uint8Array> = {};
  await Promise.all(packagePaths.map(async (path) => {
    const relative = path.slice(prefix.length);
    try {
      normalizePackagePath(relative);
    } catch {
      throw new RoomSourceError('SOURCE_PATH_INVALID', { path: relative });
    }
    if (files[relative] !== undefined) throw new RoomSourceError('SOURCE_PATH_INVALID', { path: relative });
    files[relative] = await readFile(path);
  }));
  return files;
}

export async function buildRoomPackageInput(
  files: Record<string, Uint8Array>,
): Promise<RoomPackageInput> {
  const manifestRaw = files[ROOM_MANIFEST_NAME];
  if (manifestRaw === undefined) throw new RoomSourceError('MANIFEST_NOT_FOUND');
  let manifest: RoomManifest;
  try {
    manifest = validateManifest(JSON.parse(decodeText(manifestRaw)));
  } catch {
    throw new RoomSourceError('MANIFEST_INVALID');
  }
  const { [ROOM_MANIFEST_NAME]: _manifest, ...packageFiles } = files;
  for (const path of packageEntryPaths(manifest)) {
    if (packageFiles[path] === undefined) throw new RoomSourceError('ENTRY_MISSING', { path });
  }
  await createPackage({ manifest, files: packageFiles });
  return { manifest, files: packageFiles };
}

export async function resolveRoomPackageFiles(
  paths: readonly string[],
  readFile: ReadSourceFile,
  scope = '.',
): Promise<{ candidate: RoomPackageCandidate; input: RoomPackageInput }> {
  const candidate = await findRoomPackageCandidate(paths, readFile, scope);
  const files = await collectRoomPackageFiles(paths, candidate, readFile);
  return { candidate, input: await buildRoomPackageInput(files) };
}

export async function unzipRoomPackage(
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<Record<string, Uint8Array>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new RoomSourceError('ZIP_INVALID');
  }
  const files: Record<string, Uint8Array> = {};
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) {
      throw new RoomSourceError('SOURCE_PATH_INVALID', { path: entry.unsafeOriginalName });
    }
    let path: string;
    try {
      path = normalizePackagePath(entry.name);
    } catch {
      throw new RoomSourceError('SOURCE_PATH_INVALID', { path: entry.name });
    }
    if (files[path] !== undefined) throw new RoomSourceError('SOURCE_PATH_INVALID', { path });
    files[path] = await entry.async('uint8array');
  }
  return files;
}

export async function resolveRoomPackageZip(
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<{ candidate: RoomPackageCandidate; input: RoomPackageInput }> {
  const files = await unzipRoomPackage(data);
  const paths = Object.keys(files);
  return resolveRoomPackageFiles(paths, async (path) => files[path], '.');
}
