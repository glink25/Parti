/**
 * 在线房间市场：以 Parti 主仓库 GitHub issue 区为注册表，以发布者仓库的
 * release 资产（parti.room.json + parti.room.zip）为产物来源。
 *
 * 只有带 `parti-room` label 的 open issue 才会上架；issue 关闭即下架。
 * 资产下载走 github.com/.../releases/.../download/... 重定向，不消耗 API 配额。
 */
import { decodeText, validateManifest, type RoomManifest } from '@parti/room-packager';
import { buildPackageInputFromFiles, unzipRoomPackage } from './importRoom';
import { saveImportedTemplate } from './templates';
import { getDb } from './db';
import {
  MARKET_GATE_LABEL,
  MARKET_MANIFEST_ASSET,
  MARKET_PACKAGE_ASSET,
  marketBadgesFromLabels,
  marketRefString,
  parseMarketIssueTitle,
  releaseAssetUrl,
  type MarketBadge,
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
  manifest?: RoomManifest;
  manifestError?: 'MANIFEST_UNAVAILABLE' | 'MANIFEST_INVALID';
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

async function fetchMarketIssues(page: number): Promise<GitHubIssueItem[]> {
  const { owner, repo } = MARKET_REGISTRY;
  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=${MARKET_GATE_LABEL}&per_page=${MARKET_PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 403 || res.status === 429) {
    throw new MarketError('REGISTRY_RATE_LIMITED', { status: res.status });
  }
  if (!res.ok) {
    throw new MarketError('REGISTRY_FETCH_FAILED', { status: res.status });
  }
  return (await res.json()) as GitHubIssueItem[];
}

async function fetchEntryManifest(ref: MarketRepoRef): Promise<Pick<MarketTemplateEntry, 'manifest' | 'manifestError'>> {
  let res: Response;
  try {
    res = await fetch(releaseAssetUrl(ref, MARKET_MANIFEST_ASSET));
  } catch {
    return { manifestError: 'MANIFEST_UNAVAILABLE' };
  }
  if (!res.ok) return { manifestError: 'MANIFEST_UNAVAILABLE' };
  try {
    const manifest = validateManifest(JSON.parse(decodeText(new Uint8Array(await res.arrayBuffer()))));
    return { manifest };
  } catch {
    return { manifestError: 'MANIFEST_INVALID' };
  }
}

async function buildMarketEntries(
  issues: GitHubIssueItem[],
  excludeRefs: ReadonlySet<string> = new Set(),
): Promise<MarketTemplateEntry[]> {
  const seen = new Set<string>();
  const refs: Array<{ ref: MarketRepoRef; issue: GitHubIssueItem }> = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const ref = parseMarketIssueTitle(issue.title);
    if (!ref) continue;
    const key = marketRefString(ref);
    if (seen.has(key) || excludeRefs.has(key)) continue;
    seen.add(key);
    refs.push({ ref, issue });
  }
  return Promise.all(
    refs.map(async ({ ref, issue }) => {
      const labels = issue.labels.map((label) => (typeof label === 'string' ? label : label.name ?? ''));
      const base: MarketTemplateEntry = {
        ...ref,
        ref: marketRefString(ref),
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        badges: marketBadgesFromLabels(labels),
      };
      return { ...base, ...(await fetchEntryManifest(ref)) };
    }),
  );
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
    const page = toPageResult(await buildMarketEntries(issues), issues.length, 1);
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
  return toPageResult(await buildMarketEntries(issues, excludeRefs), issues.length, page);
}

/** 已安装到本地（IndexedDB）的市场模版 ref 集合。 */
export async function listInstalledMarketRefs(): Promise<Set<string>> {
  const all = await (await getDb()).getAll('customPackages');
  return new Set(
    all.flatMap((record) => (record.source.type === 'market' && record.source.ref ? [record.source.ref] : [])),
  );
}

/** 下载并安装市场模版，返回保存后的模版 id。 */
export async function installMarketTemplate(entry: MarketRepoRef): Promise<string> {
  let res: Response;
  try {
    res = await fetch(releaseAssetUrl(entry, MARKET_PACKAGE_ASSET));
  } catch {
    throw new MarketError('PACKAGE_DOWNLOAD_FAILED');
  }
  if (!res.ok) {
    throw new MarketError('PACKAGE_DOWNLOAD_FAILED', { status: res.status });
  }
  const files = await unzipRoomPackage(await res.arrayBuffer());
  const input = await buildPackageInputFromFiles(files);
  return saveImportedTemplate(input, { type: 'market', ref: marketRefString(entry) });
}
