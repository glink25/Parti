import {
  GitHubSourceClient,
  RoomSourceError,
  parseMarketRepositoryTitle,
  resolveForTriage,
  type GitHubReleaseAsset,
} from '@parti/room-source';
import { writeSync } from 'node:fs';

interface TriageOutput {
  ok: boolean;
  transient?: boolean;
  message: string;
  manifest?: unknown;
  source?: unknown;
  sourceUrl?: string;
}

const title = process.env.ISSUE_TITLE ?? '';
const token = process.env.GH_TOKEN;

function output(value: TriageOutput): never {
  writeSync(1, `${JSON.stringify(value)}\n`);
  process.exit(value.ok ? 0 : 1);
}

function describeError(error: RoomSourceError): string {
  if (error.code === 'GITHUB_RATE_LIMITED') return 'GitHub API 请求受限，请稍后编辑 issue 重试。';
  if (error.code === 'GITHUB_TREE_FAILED') return `无法读取仓库文件树${error.status ? `（HTTP ${error.status}）` : ''}。`;
  if (error.code === 'GITHUB_REF_NOT_FOUND') return '仓库不存在，或 issue 标题指定的 git ref 不存在。';
  if (error.code === 'GITHUB_TREE_TRUNCATED') return '仓库文件树被 GitHub 截断，无法安全定位房间包。';
  if (error.code === 'GITHUB_DOWNLOAD_FAILED') return `房间包文件下载失败${error.path ? `：${error.path}` : ''}。`;
  if (error.code === 'NO_COMPLETE_PACKAGE') {
    const details = error.failures?.slice(0, 5).map((failure) =>
      failure.code === 'ENTRY_MISSING'
        ? `${failure.manifestPath} 缺少 ${failure.path ?? '入口文件'}`
        : `${failure.manifestPath} 的 manifest 无效`);
    return details?.length
      ? `git ref 中没有完整房间包，且没有可用的 release ZIP：${details.join('；')}。`
      : 'git ref 中没有完整房间包，且没有可用的 release ZIP。';
  }
  return `房间源检查失败：${error.code}。`;
}

async function downloadRelease(asset: GitHubReleaseAsset): Promise<Uint8Array> {
  const response = await fetch(asset.apiUrl ?? asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new RoomSourceError('GITHUB_DOWNLOAD_FAILED', { status: response.status, path: asset.name });
  }
  return new Uint8Array(await response.arrayBuffer());
}

const repo = parseMarketRepositoryTitle(title);
if (!repo) {
  output({
    ok: false,
    message: '标题格式不正确，应为 `[parti-room] owner/repo`，可选 `@ref`。',
  });
}

try {
  const resolution = await resolveForTriage(repo, new GitHubSourceClient({ token, apiFirst: true }), downloadRelease);
  const primary = resolution.metadata.primary;
  const gitPrimary = primary.kind === 'git-folder' ? primary : undefined;
  const branchPath = [resolution.resolvedGitRef, ...(gitPrimary?.packageDir && gitPrimary.packageDir !== '.'
    ? [gitPrimary.packageDir]
    : [])].map((part) => part.split('/').map(encodeURIComponent).join('/')).join('/');
  output({
    ok: true,
    manifest: resolution.manifest,
    source: resolution.metadata,
    sourceUrl: `https://github.com/${repo.owner}/${repo.repo}/tree/${branchPath}`,
    message: primary.kind === 'release-zip'
      ? `检查通过：git ref 中没有完整产物，已按 release ${primary.tag} 降级上架（仅支持下载 ZIP 后手动导入）。`
      : `检查通过：使用 ${repo.owner}/${repo.repo}@${primary.ref} 的 ${primary.packageDir} 目录一键安装${resolution.metadata.fallback ? `，release ${resolution.metadata.fallback.tag} 可作人工备用` : ''}。`,
  });
} catch (reason) {
  const error = reason instanceof RoomSourceError ? reason : new RoomSourceError('GITHUB_TREE_FAILED');
  const transient = ['GITHUB_RATE_LIMITED', 'GITHUB_TREE_FAILED', 'GITHUB_DOWNLOAD_FAILED'].includes(error.code);
  output({ ok: false, transient, message: describeError(error) });
}
