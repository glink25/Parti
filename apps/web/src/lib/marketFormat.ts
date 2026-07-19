/** 房间市场的纯函数部分：issue 标题解析、徽章映射、release 资产地址。独立成模块以便单测。 */
import { validateManifest, type RoomManifest } from '@parti/room-packager';

export const MARKET_MANIFEST_ASSET = 'parti.room.json';
export const MARKET_PACKAGE_ASSET = 'parti.room.zip';
export const MARKET_GATE_LABEL = 'parti-room';
export const MARKET_BADGE_LABELS = ['beta', 'recommend'] as const;

export type MarketBadge = (typeof MARKET_BADGE_LABELS)[number];

export interface MarketRepoRef {
  owner: string;
  repo: string;
  tag?: string;
}

/** 解析 issue 标题：`[parti-room] owner/repo` 或 `[parti-room] owner/repo@tag`。 */
export function parseMarketIssueTitle(title: string): MarketRepoRef | null {
  const match = title
    .trim()
    .match(/^\[parti-room\]\s*([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^\s]+))?\s*$/i);
  if (!match) return null;
  const [, owner, repo, tag] = match;
  return tag ? { owner, repo, tag } : { owner, repo };
}

/** 从 issue labels 中提取展示徽章（保持 MARKET_BADGE_LABELS 的顺序）。 */
export function marketBadgesFromLabels(labels: string[]): MarketBadge[] {
  return MARKET_BADGE_LABELS.filter((badge) => labels.includes(badge));
}

/** release 资产下载地址；走 github.com 重定向，不占用 GitHub API 配额。 */
export function releaseAssetUrl(ref: MarketRepoRef, asset: string): string {
  const base = `https://github.com/${ref.owner}/${ref.repo}/releases`;
  return ref.tag
    ? `${base}/download/${encodeURIComponent(ref.tag)}/${asset}`
    : `${base}/latest/download/${asset}`;
}

export function marketRefString(ref: MarketRepoRef): string {
  return ref.tag ? `${ref.owner}/${ref.repo}@${ref.tag}` : `${ref.owner}/${ref.repo}`;
}

/** issue 正文中由 triage workflow 写入的 manifest 区块标记。 */
export const MARKET_MANIFEST_START = '<!-- parti-room:manifest:start -->';
export const MARKET_MANIFEST_END = '<!-- parti-room:manifest:end -->';
/** issue 正文中记录房间包所在目录的标记：`<!-- parti-room:package-dir:dist -->`。 */
export const MARKET_PACKAGE_DIR_PATTERN = /<!--\s*parti-room:package-dir:([^\s>]+)\s*-->/;

export type MarketManifestError = 'MANIFEST_UNAVAILABLE' | 'MANIFEST_INVALID';

export type MarketManifestParseResult =
  | { manifest: RoomManifest; packageDir: string }
  | { manifestError: MarketManifestError };

/** 从 issue 正文解析房间包目录标记，缺省为仓库根目录（`.`）。 */
export function parsePackageDirFromIssueBody(body: string | null | undefined): string {
  const match = body?.match(MARKET_PACKAGE_DIR_PATTERN);
  return match ? match[1] : '.';
}

/**
 * 从 issue 正文解析 manifest：优先取 triage 写入的标记区块，兜底找
 * ```parti.room.json 代码块（兼容手动打标的 issue）。
 */
export function parseManifestFromIssueBody(body: string | null | undefined): MarketManifestParseResult {
  if (!body) return { manifestError: 'MANIFEST_UNAVAILABLE' };
  let jsonText: string | null = null;

  const start = body.indexOf(MARKET_MANIFEST_START);
  const end = body.indexOf(MARKET_MANIFEST_END);
  if (start !== -1 && end !== -1 && end > start) {
    const block = body.slice(start + MARKET_MANIFEST_START.length, end);
    const fence = block.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    jsonText = (fence ? fence[1] : block).trim();
  } else {
    const fence = body.match(/```parti\.room\.json\s*\n([\s\S]*?)```/);
    if (fence) jsonText = fence[1].trim();
  }

  if (!jsonText) return { manifestError: 'MANIFEST_UNAVAILABLE' };
  try {
    return { manifest: validateManifest(JSON.parse(jsonText)), packageDir: parsePackageDirFromIssueBody(body) };
  } catch {
    return { manifestError: 'MANIFEST_INVALID' };
  }
}

/** 拼接包内相对路径：包目录为 `.`（仓库根）时直接返回文件名。 */
export function joinPackagePath(packageDir: string, name: string): string {
  return packageDir === '.' ? name : `${packageDir}/${name}`;
}

/**
 * 在仓库文件路径列表中定位房间包目录（最浅的 parti.room.json 所在目录），
 * 与 ZIP 导入的剥前缀规则一致；找不到返回 null。
 */
export function findPackageDirInPaths(paths: string[]): string | null {
  const candidates = paths
    .filter((path) => path === MARKET_MANIFEST_ASSET || path.endsWith(`/${MARKET_MANIFEST_ASSET}`))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (candidates.length === 0) return null;
  const dir = candidates[0].slice(0, candidates[0].length - MARKET_MANIFEST_ASSET.length).replace(/\/$/, '');
  return dir === '' ? '.' : dir;
}

/** jsdelivr 数据 API：列出一个仓库 ref 下的完整文件树（带 CORS，不占 GitHub API 配额）。 */
export function jsdelivrTreeUrl(ref: MarketRepoRef, gitRef: string): string {
  return `https://data.jsdelivr.com/v1/packages/gh/${ref.owner}/${ref.repo}@${encodeURIComponent(gitRef)}`;
}

/** jsdelivr CDN：按仓库 ref + 路径拉取单个文件（带 CORS）。 */
export function jsdelivrFileUrl(ref: MarketRepoRef, gitRef: string, path: string): string {
  return `https://cdn.jsdelivr.net/gh/${ref.owner}/${ref.repo}@${encodeURIComponent(gitRef)}/${path}`;
}

/**
 * 解析市场卡片的封面地址：绝对 URL 原样使用；相对路径按包目录解析到发布仓库
 * （github.com/raw 302 到默认分支，`<img>`/CSS 展示不需要 CORS）。
 */
export function resolveMarketCover(
  ref: MarketRepoRef,
  packageDir: string,
  cover: string | undefined,
): string | undefined {
  if (!cover) return undefined;
  if (/^(https?:)?\/\//.test(cover)) return cover;
  const branch = ref.tag ?? 'HEAD';
  const path = joinPackagePath(packageDir, cover.replace(/^\.?\//, ''));
  return `https://github.com/${ref.owner}/${ref.repo}/raw/${encodeURIComponent(branch)}/${path}`;
}
