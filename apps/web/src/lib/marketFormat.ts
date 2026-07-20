/** 房间市场的纯函数部分：issue 标题解析、徽章映射、release 资产地址。独立成模块以便单测。 */
import { validateManifest, type RoomManifest } from '@parti/room-packager';
import { parseMarketRepositoryTitle, type MarketRoomSourceMetadata } from '@parti/room-source';

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

/** 解析 issue 标题：`[parti-room] owner/repo` 或 `[parti-room] owner/repo@ref`。 */
export function parseMarketIssueTitle(title: string): MarketRepoRef | null {
  const parsed = parseMarketRepositoryTitle(title);
  if (!parsed) return null;
  return parsed.ref
    ? { owner: parsed.owner, repo: parsed.repo, tag: parsed.ref }
    : { owner: parsed.owner, repo: parsed.repo };
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
/** triage 写入的版本化安装来源元数据。 */
export const MARKET_SOURCE_PATTERN = /<!--\s*parti-room:source:(\{[^\r\n]*\})\s*-->/;

export type MarketManifestError = 'MANIFEST_UNAVAILABLE' | 'MANIFEST_INVALID';

export type MarketManifestParseResult =
  | { manifest: RoomManifest; packageDir: string }
  | { manifestError: MarketManifestError };

/** 从 issue 正文解析房间包目录标记，缺省为仓库根目录（`.`）。 */
export function parsePackageDirFromIssueBody(body: string | null | undefined): string {
  const match = body?.match(MARKET_PACKAGE_DIR_PATTERN);
  return match ? match[1] : '.';
}

/** 解析 triage 写入的版本化来源标记；旧 issue 没有该标记时返回 undefined。 */
export function parseMarketSourceFromIssueBody(
  body: string | null | undefined,
): MarketRoomSourceMetadata | undefined {
  const match = body?.match(MARKET_SOURCE_PATTERN);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]) as MarketRoomSourceMetadata;
    if (value.schema !== 1 || !value.primary || (value.primary.kind !== 'git-folder' && value.primary.kind !== 'release-zip')) {
      return undefined;
    }
    if (value.primary.kind === 'git-folder') {
      if (!value.primary.ref || !value.primary.packageDir) return undefined;
      if (value.primary.refKind && value.primary.refKind !== 'branch' && value.primary.refKind !== 'tag') return undefined;
    } else if (!value.primary.tag || !value.primary.url || value.primary.asset !== MARKET_PACKAGE_ASSET) {
      return undefined;
    }
    if (value.fallback && (
      value.fallback.kind !== 'release-zip' ||
      !value.fallback.tag ||
      !value.fallback.url ||
      value.fallback.asset !== MARKET_PACKAGE_ASSET
    )) return undefined;
    return value;
  } catch {
    return undefined;
  }
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

/** 来源标记中已由 triage 校验过的 release ZIP 下载地址。 */
export function marketReleaseUrl(
  source: MarketRoomSourceMetadata | undefined,
  ref: MarketRepoRef,
): string {
  if (!source) return releaseAssetUrl(ref, MARKET_PACKAGE_ASSET);
  if (source.primary.kind === 'release-zip') return source.primary.url;
  if (source.fallback) return source.fallback.url;
  // 旧版 git source 标记没有 refKind；专用发布源通常是分支，按 latest 兜底。
  return releaseAssetUrl(
    source.primary.refKind === 'tag' ? { ...ref, tag: source.primary.ref } : { owner: ref.owner, repo: ref.repo },
    MARKET_PACKAGE_ASSET,
  );
}
