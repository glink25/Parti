/**
 * 在线房间市场：以 Parti 主仓库 GitHub issue 区为注册表。
 *
 * - 列表：issues API 一次请求（body 内嵌 manifest，由 triage workflow 写入），
 *   只有带 `parti-room` label 的 open issue 才会上架；issue 关闭即下架。
 * - 安装：经 jsdelivr（data.jsdelivr.com 列文件树 + cdn.jsdelivr.net 拉文件）
 *   直接读取发布者仓库中的房间包文件，不占 GitHub API 配额、无 CORS 限制。
 *   release 中的 parti.room.zip 仅作为存档与手动导入的降级通道。
 */
import type { RoomManifest } from '@parti/room-packager';
import { buildPackageInputFromFiles } from './importRoom';
import { saveImportedTemplate } from './templates';
import { getDb } from './db';
import {
  findPackageDirInPaths,
  joinPackagePath,
  jsdelivrFileUrl,
  jsdelivrTreeUrl,
  MARKET_GATE_LABEL,
  marketBadgesFromLabels,
  marketRefString,
  parseManifestFromIssueBody,
  parseMarketIssueTitle,
  parsePackageDirFromIssueBody,
  resolveMarketCover,
  type MarketBadge,
  type MarketManifestError,
  type MarketRepoRef,
} from './marketFormat';

export * from './marketFormat';

const DEFAULT_REGISTRY = { owner: 'glink25', repo: 'Parti' };

function parseRegistry(value: string | undefined): { owner: string; repo: string } {
  const match = value?.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return match ? { owner: match[1], repo: match[2] } : DEFAULT_REGISTRY;
}

/** 注册表所在仓库，可用 VITE_MARKET_REGISTRY=owner/repo 覆盖。 */
export const MARKET_REGISTRY = parseRegistry(import.meta.env.VITE_MARKET_REGISTRY);

/** 发布指南文档地址（跟随注册表仓库）。 */
export const MARKET_DOCS_URL = `https://github.com/${MARKET_REGISTRY.owner}/${MARKET_REGISTRY.repo}/blob/main/docs/room-market.md`;

export type MarketErrorCode =
  | 'REGISTRY_FETCH_FAILED'
  | 'REGISTRY_RATE_LIMITED'
  | 'RATE_LIMITED'
  | 'PACKAGE_DOWNLOAD_FAILED';

export class MarketError extends Error {
  readonly code: MarketErrorCode;
  readonly status?: number;

  constructor(code: MarketErrorCode, options: { status?: number } = {}) {
    super(code);
    this.name = 'MarketError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
  }
}

export interface MarketTemplateEntry extends MarketRepoRef {
  /** `owner/repo` 或 `owner/repo@tag`，同时用作 IndexedDB 中的 source.ref。 */
  ref: string;
  issueNumber: number;
  issueUrl: string;
  badges: MarketBadge[];
  /** 房间包在仓库中的目录（`.` 表示根目录）。 */
  packageDir: string;
  cover?: string;
  manifest?: RoomManifest;
  manifestError?: MarketManifestError;
}

export interface MarketListResult {
  entries: MarketTemplateEntry[];
  /** 数据来自 localStorage 缓存（未重新请求注册表）。 */
  fromCache: boolean;
  /** 注册表请求失败，展示的是过期缓存。 */
  stale: boolean;
  /** 注册表是否还有下一页。 */
  hasMore: boolean;
  /** 下一次加载更多时应请求的页码（1-based）。 */
  nextPage: number;
  error?: MarketError;
}

interface GitHubIssueItem {
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  pull_request?: unknown;
  labels: Array<string | { name?: string }>;
}

const CACHE_KEY = 'parti-market-cache-v1';
const CACHE_TTL = 10 * 60 * 1000;
/** 注册表每页拉取的 issue 数。 */
export const MARKET_PAGE_SIZE = 30;

interface MarketCache {
  fetchedAt: number;
  entries: MarketTemplateEntry[];
  nextPage: number;
  hasMore: boolean;
}

function readCache(): MarketCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketCache;
    if (typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.entries)) return null;
    return {
      fetchedAt: parsed.fetchedAt,
      entries: parsed.entries,
      nextPage: typeof parsed.nextPage === 'number' ? parsed.nextPage : 2,
      hasMore: Boolean(parsed.hasMore),
    };
  } catch {
    return null;
  }
}

/** 把当前市场列表状态写入缓存（首页拉取和加载更多后都会调用）。 */
export function cacheMarketState(entries: MarketTemplateEntry[], nextPage: number, hasMore: boolean): void {
  try {
    const cache: MarketCache = { fetchedAt: Date.now(), entries, nextPage, hasMore };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 缓存不可用（隐私模式等）时静默忽略，下次重新拉取。
  }
}

function isRateLimited(res: Response): boolean {
  return res.status === 403 || res.status === 429;
}

async function fetchMarketIssues(page: number): Promise<GitHubIssueItem[]> {
  const { owner, repo } = MARKET_REGISTRY;
  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=${MARKET_GATE_LABEL}&per_page=${MARKET_PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (isRateLimited(res)) {
    throw new MarketError('REGISTRY_RATE_LIMITED', { status: res.status });
  }
  if (!res.ok) {
    throw new MarketError('REGISTRY_FETCH_FAILED', { status: res.status });
  }
  return (await res.json()) as GitHubIssueItem[];
}

function buildMarketEntries(
  issues: GitHubIssueItem[],
  excludeRefs: ReadonlySet<string> = new Set(),
): MarketTemplateEntry[] {
  const seen = new Set<string>();
  const entries: MarketTemplateEntry[] = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const ref = parseMarketIssueTitle(issue.title);
    if (!ref) continue;
    const key = marketRefString(ref);
    if (seen.has(key) || excludeRefs.has(key)) continue;
    seen.add(key);

    const labels = issue.labels.map((label) => (typeof label === 'string' ? label : label.name ?? ''));
    const parsed = parseManifestFromIssueBody(issue.body);
    const packageDir = parsePackageDirFromIssueBody(issue.body);
    const manifest = 'manifest' in parsed ? parsed.manifest : undefined;
    entries.push({
      ...ref,
      ref: key,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      badges: marketBadgesFromLabels(labels),
      packageDir,
      ...(manifest ? { manifest, cover: resolveMarketCover(ref, packageDir, manifest.cover) } : {}),
      ...('manifestError' in parsed ? { manifestError: parsed.manifestError } : {}),
    });
  }
  return entries;
}

function toPageResult(entries: MarketTemplateEntry[], rawCount: number, page: number) {
  // 以原始 issue 数判断是否有下一页（过滤 PR / 无效标题后的条目数不可靠）。
  return { entries, hasMore: rawCount >= MARKET_PAGE_SIZE, nextPage: page + 1 };
}

/**
 * 列出市场首页的房间模版。默认使用 10 分钟内的缓存；注册表请求失败时
 * 回退到过期缓存并标记 stale。不会抛错，错误通过返回值表达。
 */
export async function listMarketTemplates(options: { forceRefresh?: boolean } = {}): Promise<MarketListResult> {
  const cached = readCache();
  if (!options.forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { entries: cached.entries, fromCache: true, stale: false, hasMore: cached.hasMore, nextPage: cached.nextPage };
  }
  try {
    const issues = await fetchMarketIssues(1);
    const page = toPageResult(buildMarketEntries(issues), issues.length, 1);
    cacheMarketState(page.entries, page.nextPage, page.hasMore);
    return { ...page, fromCache: false, stale: false };
  } catch (reason) {
    const error = reason instanceof MarketError ? reason : new MarketError('REGISTRY_FETCH_FAILED');
    if (cached) {
      return {
        entries: cached.entries,
        fromCache: true,
        stale: true,
        hasMore: cached.hasMore,
        nextPage: cached.nextPage,
        error,
      };
    }
    return { entries: [], fromCache: false, stale: false, hasMore: false, nextPage: 1, error };
  }
}

/**
 * 加载市场的下一页。`excludeRefs` 传入已展示的 ref，跨页去重。
 * 与首页不同，失败时直接抛出 MarketError，由调用方展示重试入口。
 */
export async function loadMarketPage(
  page: number,
  excludeRefs: ReadonlySet<string>,
): Promise<{ entries: MarketTemplateEntry[]; hasMore: boolean; nextPage: number }> {
  const issues = await fetchMarketIssues(page);
  return toPageResult(buildMarketEntries(issues, excludeRefs), issues.length, page);
}

/** 已安装到本地（IndexedDB）的市场模版 ref 集合。 */
export async function listInstalledMarketRefs(): Promise<Set<string>> {
  const all = await (await getDb()).getAll('customPackages');
  return new Set(
    all.flatMap((record) => (record.source.type === 'market' && record.source.ref ? [record.source.ref] : [])),
  );
}

/** issue 未锁定 ref 时，解析仓库默认分支（安装时唯一一次 GitHub API 调用）。 */
async function resolveDefaultBranch(entry: MarketRepoRef): Promise<string> {
  const url = `https://api.github.com/repos/${entry.owner}/${entry.repo}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (isRateLimited(res)) {
    throw new MarketError('RATE_LIMITED', { status: res.status });
  }
  if (!res.ok) {
    throw new MarketError('PACKAGE_DOWNLOAD_FAILED', { status: res.status });
  }
  const data = (await res.json()) as { default_branch?: string };
  if (!data.default_branch) throw new MarketError('PACKAGE_DOWNLOAD_FAILED');
  return data.default_branch;
}

interface JsdelivrTreeNode {
  type: 'file' | 'directory';
  name: string;
  files?: JsdelivrTreeNode[];
}

function flattenJsdelivrPaths(nodes: JsdelivrTreeNode[], prefix = ''): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'file') {
      paths.push(path);
    } else if (node.files) {
      paths.push(...flattenJsdelivrPaths(node.files, path));
    }
  }
  return paths;
}

/**
 * 下载并安装市场模版：经 jsdelivr 读取发布仓库中的房间包文件
 * （不消耗 GitHub API 配额），返回保存后的模版 id。
 */
export async function installMarketTemplate(entry: MarketRepoRef & { packageDir?: string }): Promise<string> {
  const gitRef = entry.tag ?? (await resolveDefaultBranch(entry));

  const treeRes = await fetch(jsdelivrTreeUrl(entry, gitRef));
  if (!treeRes.ok) {
    throw new MarketError('PACKAGE_DOWNLOAD_FAILED', { status: treeRes.status });
  }
  const tree = (await treeRes.json()) as { files?: JsdelivrTreeNode[] };
  const paths = flattenJsdelivrPaths(tree.files ?? []);

  const packageDir = entry.packageDir ?? findPackageDirInPaths(paths);
  if (!packageDir || !paths.includes(joinPackagePath(packageDir, 'parti.room.json'))) {
    throw new MarketError('PACKAGE_DOWNLOAD_FAILED');
  }

  const prefix = packageDir === '.' ? '' : `${packageDir}/`;
  const packagePaths = paths.filter((path) => (prefix ? path.startsWith(prefix) : true));
  const files: Record<string, Uint8Array> = {};
  await Promise.all(
    packagePaths.map(async (path) => {
      const res = await fetch(jsdelivrFileUrl(entry, gitRef, path));
      if (!res.ok) throw new MarketError('PACKAGE_DOWNLOAD_FAILED', { status: res.status });
      files[path.slice(prefix.length)] = new Uint8Array(await res.arrayBuffer());
    }),
  );

  const input = await buildPackageInputFromFiles(files);
  return saveImportedTemplate(input, { type: 'market', ref: marketRefString(entry) });
}
