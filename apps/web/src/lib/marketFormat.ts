/** 房间市场的纯函数部分：issue 标题解析、徽章映射、release 资产地址。独立成模块以便单测。 */

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
