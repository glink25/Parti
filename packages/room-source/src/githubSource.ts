import type { RoomManifest, RoomPackageInput } from '@parti/room-packager';
import {
  ROOM_RELEASE_ASSET,
  RoomSourceError,
  resolveRoomPackageFiles,
  resolveRoomPackageZip,
  type RoomPackageCandidate,
} from './packageSource';

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

/** 市场 issue 标题：`[parti-room] owner/repo` 或可选的 `@ref`。 */
export function parseMarketRepositoryTitle(title: string): GitHubRepoRef | null {
  const match = title.trim().match(
    /^\[parti-room\]\s*([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^\s]+))?\s*$/i,
  );
  if (!match) return null;
  const [, owner, repo, ref] = match;
  return ref ? { owner, repo, ref } : { owner, repo };
}

export interface GitHubRoomRequest extends GitHubRepoRef {
  scope?: string;
}

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  kind: 'repository' | 'tree' | 'blob';
  refAndPath: string[];
}

export interface ResolvedGitHubRoomRequest {
  owner: string;
  repo: string;
  ref: string;
  scope: string;
  explicitRef: boolean;
}

export interface GitHubReleaseAsset {
  name: string;
  url: string;
  apiUrl?: string;
  size?: number;
  digest?: string | null;
}

export interface GitHubReleaseFallback {
  tag: string;
  asset: GitHubReleaseAsset;
}

export interface GitFolderRoomSource {
  kind: 'git-folder';
  ref: string;
  packageDir: string;
}

export interface ReleaseZipRoomSource {
  kind: 'release-zip';
  tag: string;
  asset: string;
  url: string;
  manual: true;
}

export interface MarketRoomSourceMetadata {
  schema: 1;
  primary: GitFolderRoomSource | ReleaseZipRoomSource;
  fallback?: ReleaseZipRoomSource;
}

export interface ResolvedRepositoryPackage {
  request: ResolvedGitHubRoomRequest;
  candidate: RoomPackageCandidate;
  input: RoomPackageInput;
}

export interface GitHubSourceClientOptions {
  fetch?: typeof fetch;
  token?: string;
  /** Triage 使用 GitHub API 读取当前 ref，避免 jsDelivr 分支缓存影响预检。 */
  apiFirst?: boolean;
}

interface JsdelivrTreeNode {
  type: 'file' | 'directory';
  name: string;
  files?: JsdelivrTreeNode[];
}

interface GitHubTreeResponse {
  tree?: Array<{ type?: string; path?: string }>;
  truncated?: boolean;
}

function rateLimited(response: Response): boolean {
  return response.status === 403 || response.status === 429;
}

function apiHeaders(token?: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function parseGitHubRoomUrl(value: string): ParsedGitHubUrl {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RoomSourceError('GITHUB_URL_INVALID');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RoomSourceError('GITHUB_URL_INVALID');
  if (url.hostname.toLowerCase() !== 'github.com') throw new RoomSourceError('GITHUB_URL_INVALID');
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts.length < 2) throw new RoomSourceError('GITHUB_URL_INVALID');
  const [owner, rawRepo, route, ...refAndPath] = parts;
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new RoomSourceError('GITHUB_URL_INVALID');
  }
  if (!route) return { owner, repo, kind: 'repository', refAndPath: [] };
  if ((route !== 'tree' && route !== 'blob') || refAndPath.length === 0) {
    throw new RoomSourceError('GITHUB_URL_INVALID');
  }
  try {
    return { owner, repo, kind: route, refAndPath: refAndPath.map(decodeURIComponent) };
  } catch {
    throw new RoomSourceError('GITHUB_URL_INVALID');
  }
}

export function flattenJsdelivrTree(nodes: JsdelivrTreeNode[], prefix = ''): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'file') paths.push(path);
    else if (node.files) paths.push(...flattenJsdelivrTree(node.files, path));
  }
  return paths;
}

export class GitHubSourceClient {
  private readonly request: typeof fetch;
  private readonly token?: string;
  private readonly apiFirst: boolean;

  constructor(options: GitHubSourceClientOptions = {}) {
    this.request = options.fetch ?? fetch;
    this.token = options.token;
    this.apiFirst = options.apiFirst ?? false;
  }

  async defaultBranch(repo: GitHubRepoRef): Promise<string> {
    const response = await this.request(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
      headers: apiHeaders(this.token),
    });
    if (rateLimited(response)) throw new RoomSourceError('GITHUB_RATE_LIMITED', { status: response.status });
    if (response.status === 404) throw new RoomSourceError('GITHUB_REF_NOT_FOUND', { status: response.status });
    if (!response.ok) throw new RoomSourceError('GITHUB_TREE_FAILED', { status: response.status });
    const data = await response.json() as { default_branch?: string };
    if (!data.default_branch) throw new RoomSourceError('GITHUB_REF_NOT_FOUND');
    return data.default_branch;
  }

  async refExists(repo: GitHubRepoRef, ref: string): Promise<boolean> {
    for (const namespace of ['heads', 'tags']) {
      const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/ref/${namespace}/${encodeURIComponent(ref)}`;
      const response = await this.request(url, { headers: apiHeaders(this.token) });
      if (rateLimited(response)) throw new RoomSourceError('GITHUB_RATE_LIMITED', { status: response.status });
      if (response.ok) return true;
      if (response.status !== 404) throw new RoomSourceError('GITHUB_TREE_FAILED', { status: response.status });
    }
    return false;
  }

  async resolveUrl(value: string): Promise<ResolvedGitHubRoomRequest> {
    const parsed = parseGitHubRoomUrl(value);
    if (parsed.kind === 'repository') {
      return {
        owner: parsed.owner,
        repo: parsed.repo,
        ref: await this.defaultBranch(parsed),
        scope: '.',
        explicitRef: false,
      };
    }
    for (let length = parsed.refAndPath.length; length >= 1; length -= 1) {
      const ref = parsed.refAndPath.slice(0, length).join('/');
      if (!(await this.refExists(parsed, ref))) continue;
      const remainder = parsed.refAndPath.slice(length);
      const scopeParts = parsed.kind === 'blob' ? remainder.slice(0, -1) : remainder;
      return {
        owner: parsed.owner,
        repo: parsed.repo,
        ref,
        scope: scopeParts.join('/') || '.',
        explicitRef: true,
      };
    }
    throw new RoomSourceError('GITHUB_REF_NOT_FOUND');
  }

  async listPaths(repo: GitHubRepoRef, ref: string): Promise<string[]> {
    if (!this.apiFirst) {
      try {
        const response = await this.request(
          `https://data.jsdelivr.com/v1/packages/gh/${repo.owner}/${repo.repo}@${encodeURIComponent(ref)}`,
        );
        if (response.ok) {
          const data = await response.json() as { files?: JsdelivrTreeNode[] };
          if (Array.isArray(data.files)) {
            const paths = flattenJsdelivrTree(data.files);
            if (paths.length > 0) return paths;
          }
        }
      } catch {
        // GitHub tree API below is the authoritative fallback.
      }
    }

    let response: Response;
    try {
      response = await this.request(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        { headers: apiHeaders(this.token) },
      );
    } catch {
      throw new RoomSourceError('GITHUB_TREE_FAILED');
    }
    if (rateLimited(response)) throw new RoomSourceError('GITHUB_RATE_LIMITED', { status: response.status });
    if (response.status === 404) throw new RoomSourceError('GITHUB_REF_NOT_FOUND', { status: response.status });
    if (!response.ok) throw new RoomSourceError('GITHUB_TREE_FAILED', { status: response.status });
    const data = await response.json() as GitHubTreeResponse;
    if (data.truncated) throw new RoomSourceError('GITHUB_TREE_TRUNCATED');
    return (data.tree ?? []).flatMap((item) =>
      item.type === 'blob' && typeof item.path === 'string' ? [item.path] : []);
  }

  async readRepositoryFile(repo: GitHubRepoRef, ref: string, path: string): Promise<Uint8Array> {
    const url = this.apiFirst
      ? `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
      : `https://cdn.jsdelivr.net/gh/${repo.owner}/${repo.repo}@${encodeURIComponent(ref)}/${path}`;
    const response = await this.request(url, this.apiFirst ? {
      headers: { ...apiHeaders(this.token), Accept: 'application/vnd.github.raw+json' },
    } : undefined);
    if (rateLimited(response)) {
      throw new RoomSourceError('GITHUB_RATE_LIMITED', { status: response.status, path });
    }
    if (!response.ok) {
      throw new RoomSourceError('GITHUB_DOWNLOAD_FAILED', { status: response.status, path });
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async resolveRepository(request: ResolvedGitHubRoomRequest): Promise<ResolvedRepositoryPackage> {
    const paths = await this.listPaths(request, request.ref);
    const resolved = await resolveRoomPackageFiles(
      paths,
      (path) => this.readRepositoryFile(request, request.ref, path),
      request.scope,
    );
    return { request, ...resolved };
  }

  async releaseFallback(repo: GitHubRepoRef, ref?: string): Promise<GitHubReleaseFallback | null> {
    const endpoint = ref
      ? `releases/tags/${encodeURIComponent(ref)}`
      : 'releases/latest';
    const response = await this.request(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/${endpoint}`,
      { headers: apiHeaders(this.token) },
    );
    if (rateLimited(response)) throw new RoomSourceError('GITHUB_RATE_LIMITED', { status: response.status });
    if (response.status === 404) return null;
    if (!response.ok) throw new RoomSourceError('GITHUB_DOWNLOAD_FAILED', { status: response.status });
    const data = await response.json() as {
      tag_name?: string;
      assets?: Array<{
        name?: string;
        browser_download_url?: string;
        url?: string;
        size?: number;
        digest?: string | null;
      }>;
    };
    const asset = data.assets?.find((item) => item.name === ROOM_RELEASE_ASSET);
    if (!data.tag_name || !asset?.browser_download_url) return null;
    return {
      tag: data.tag_name,
      asset: {
        name: ROOM_RELEASE_ASSET,
        url: asset.browser_download_url,
        ...(asset.url ? { apiUrl: asset.url } : {}),
        ...(typeof asset.size === 'number' ? { size: asset.size } : {}),
        ...(asset.digest !== undefined ? { digest: asset.digest } : {}),
      },
    };
  }
}

export function releaseSource(fallback: GitHubReleaseFallback): ReleaseZipRoomSource {
  return {
    kind: 'release-zip',
    tag: fallback.tag,
    asset: fallback.asset.name,
    url: fallback.asset.url,
    manual: true,
  };
}

export function gitSource(ref: string, packageDir: string): GitFolderRoomSource {
  return { kind: 'git-folder', ref, packageDir };
}

export interface TriageResolution {
  metadata: MarketRoomSourceMetadata;
  manifest: RoomManifest;
  resolvedGitRef: string;
  gitError?: RoomSourceError;
  releaseError?: RoomSourceError;
}

export async function resolveForTriage(
  repo: GitHubRepoRef,
  client: GitHubSourceClient,
  downloadRelease: (asset: GitHubReleaseAsset) => Promise<Uint8Array>,
): Promise<TriageResolution> {
  const explicitRef = repo.ref;
  const ref = explicitRef ?? await client.defaultBranch(repo);
  let repository: ResolvedRepositoryPackage | undefined;
  let gitError: RoomSourceError | undefined;
  try {
    repository = await client.resolveRepository({ ...repo, ref, scope: '.', explicitRef: Boolean(explicitRef) });
  } catch (reason) {
    gitError = reason instanceof RoomSourceError ? reason : new RoomSourceError('GITHUB_TREE_FAILED');
  }

  let fallback: GitHubReleaseFallback | null = null;
  let releaseInput: RoomPackageInput | undefined;
  let releaseError: RoomSourceError | undefined;
  try {
    fallback = await client.releaseFallback(repo, explicitRef);
    if (fallback) {
      releaseInput = (await resolveRoomPackageZip(await downloadRelease(fallback.asset))).input;
    }
  } catch (reason) {
    releaseError = reason instanceof RoomSourceError ? reason : new RoomSourceError('ZIP_INVALID');
  }

  if (repository) {
    return {
      resolvedGitRef: ref,
      manifest: repository.input.manifest as RoomManifest,
      metadata: {
        schema: 1,
        primary: gitSource(ref, repository.candidate.packageDir),
        ...(fallback && releaseInput ? { fallback: releaseSource(fallback) } : {}),
      },
      ...(releaseError ? { releaseError } : {}),
    };
  }
  if (fallback && releaseInput) {
    return {
      resolvedGitRef: ref,
      manifest: releaseInput.manifest as RoomManifest,
      metadata: { schema: 1, primary: releaseSource(fallback) },
      ...(gitError ? { gitError } : {}),
    };
  }
  const transient = [gitError, releaseError].find((error) => error && [
    'GITHUB_RATE_LIMITED',
    'GITHUB_TREE_FAILED',
    'GITHUB_DOWNLOAD_FAILED',
  ].includes(error.code));
  if (transient) throw transient;
  if (gitError?.code === 'GITHUB_TREE_TRUNCATED' || gitError?.code === 'GITHUB_REF_NOT_FOUND') {
    throw gitError;
  }
  throw new RoomSourceError('NO_COMPLETE_PACKAGE', {
    failures: gitError?.failures,
  });
}

export async function resolveGitHubImport(
  url: string,
  client: GitHubSourceClient,
): Promise<ResolvedRepositoryPackage> {
  const request = await client.resolveUrl(url);
  try {
    return await client.resolveRepository(request);
  } catch (reason) {
    const fallback = await client.releaseFallback(request, request.explicitRef ? request.ref : undefined);
    if (fallback) {
      throw new RoomSourceError('RELEASE_MANUAL_REQUIRED', { releaseUrl: fallback.asset.url });
    }
    throw reason;
  }
}
