import { describe, expect, it } from 'vitest';
import {
  joinPackagePath,
  marketBadgesFromLabels,
  marketRefString,
  parseManifestFromIssueBody,
  parseMarketSourceFromIssueBody,
  parseMarketIssueTitle,
  parsePackageDirFromIssueBody,
  resolveMarketCover,
  releaseAssetUrl,
} from './marketFormat';

const VALID_MANIFEST = JSON.stringify({
  partiVersion: '0.1.0',
  protocolVersion: 1,
  id: 'game-a',
  name: 'Game A',
  version: '1.0.0',
  packageMode: 'blob',
  entry: { ui: 'index.html', worker: 'room.worker.js' },
});

describe('parseMarketIssueTitle', () => {
  it('parses owner/repo without tag', () => {
    expect(parseMarketIssueTitle('[parti-room] alice/game-a')).toEqual({ owner: 'alice', repo: 'game-a' });
  });

  it('parses owner/repo with a release tag', () => {
    expect(parseMarketIssueTitle('[parti-room] alice/game-a@v1.2.0')).toEqual({
      owner: 'alice',
      repo: 'game-a',
      tag: 'v1.2.0',
    });
  });

  it('tolerates extra whitespace and case-insensitive prefix', () => {
    expect(parseMarketIssueTitle('  [Parti-Room]   bob/snake_2  ')).toEqual({ owner: 'bob', repo: 'snake_2' });
  });

  it('rejects titles without the prefix or repo path', () => {
    expect(parseMarketIssueTitle('alice/game-a')).toBeNull();
    expect(parseMarketIssueTitle('[parti-room] alice')).toBeNull();
    expect(parseMarketIssueTitle('[parti-room] alice/game-a extra')).toBeNull();
    expect(parseMarketIssueTitle('[bug] something broken')).toBeNull();
    expect(parseMarketIssueTitle('')).toBeNull();
  });
});

describe('marketBadgesFromLabels', () => {
  it('keeps known badges in canonical order', () => {
    expect(marketBadgesFromLabels(['recommend', 'parti-room', 'beta'])).toEqual(['beta', 'recommend']);
  });

  it('ignores unknown labels', () => {
    expect(marketBadgesFromLabels(['parti-room', 'bug'])).toEqual([]);
    expect(marketBadgesFromLabels([])).toEqual([]);
  });
});

describe('releaseAssetUrl', () => {
  it('uses latest release when no tag is given', () => {
    expect(releaseAssetUrl({ owner: 'alice', repo: 'game-a' }, 'parti.room.zip')).toBe(
      'https://github.com/alice/game-a/releases/latest/download/parti.room.zip',
    );
  });

  it('uses the tagged release when a tag is given', () => {
    expect(releaseAssetUrl({ owner: 'alice', repo: 'game-a', tag: 'v1.0' }, 'parti.room.json')).toBe(
      'https://github.com/alice/game-a/releases/download/v1.0/parti.room.json',
    );
  });
});

describe('marketRefString', () => {
  it('renders owner/repo with optional tag', () => {
    expect(marketRefString({ owner: 'alice', repo: 'game-a' })).toBe('alice/game-a');
    expect(marketRefString({ owner: 'alice', repo: 'game-a', tag: 'v2' })).toBe('alice/game-a@v2');
  });
});

describe('parseManifestFromIssueBody', () => {
  it('parses the triage-written marker block and package dir', () => {
    const body = `介绍文字\n\n<!-- parti-room:manifest:start -->\n\`\`\`json\n${VALID_MANIFEST}\n\`\`\`\n<!-- parti-room:manifest:end -->\n<!-- parti-room:package-dir:dist -->`;
    const result = parseManifestFromIssueBody(body);
    expect(result).toMatchObject({ manifest: { id: 'game-a' }, packageDir: 'dist' });
  });

  it('falls back to a parti.room.json fenced block and defaults packageDir to root', () => {
    const body = `一些说明\n\`\`\`parti.room.json\n${VALID_MANIFEST}\n\`\`\``;
    const result = parseManifestFromIssueBody(body);
    expect(result).toMatchObject({ manifest: { id: 'game-a' }, packageDir: '.' });
  });

  it('reports MANIFEST_UNAVAILABLE when no manifest is present', () => {
    expect(parseManifestFromIssueBody(undefined)).toEqual({ manifestError: 'MANIFEST_UNAVAILABLE' });
    expect(parseManifestFromIssueBody('没有清单')).toEqual({ manifestError: 'MANIFEST_UNAVAILABLE' });
  });

  it('reports MANIFEST_INVALID for broken JSON or failed validation', () => {
    const broken = `<!-- parti-room:manifest:start -->\n\`\`\`json\n{oops\n\`\`\`\n<!-- parti-room:manifest:end -->`;
    expect(parseManifestFromIssueBody(broken)).toEqual({ manifestError: 'MANIFEST_INVALID' });
    const invalid = `<!-- parti-room:manifest:start -->\n\`\`\`json\n{"id":"x"}\n\`\`\`\n<!-- parti-room:manifest:end -->`;
    expect(parseManifestFromIssueBody(invalid)).toEqual({ manifestError: 'MANIFEST_INVALID' });
  });
});

describe('parsePackageDirFromIssueBody', () => {
  it('reads the package-dir marker and defaults to root', () => {
    expect(parsePackageDirFromIssueBody('<!-- parti-room:package-dir:packages/room -->')).toBe('packages/room');
    expect(parsePackageDirFromIssueBody('no marker')).toBe('.');
    expect(parsePackageDirFromIssueBody(null)).toBe('.');
  });
});

describe('parseMarketSourceFromIssueBody', () => {
  it('parses git and release-only source markers', () => {
    const git = {
      schema: 1,
      primary: { kind: 'git-folder', ref: 'parti-package', packageDir: '.' },
      fallback: { kind: 'release-zip', tag: 'parti-package', asset: 'parti.room.zip', url: 'https://x/room.zip', manual: true },
    };
    expect(parseMarketSourceFromIssueBody(`<!-- parti-room:source:${JSON.stringify(git)} -->`)).toEqual(git);
    const release = {
      schema: 1,
      primary: { kind: 'release-zip', tag: 'v1', asset: 'parti.room.zip', url: 'https://x/room.zip', manual: true },
    };
    expect(parseMarketSourceFromIssueBody(`<!-- parti-room:source:${JSON.stringify(release)} -->`)).toEqual(release);
  });

  it('ignores malformed source markers', () => {
    expect(parseMarketSourceFromIssueBody('<!-- parti-room:source:{oops} -->')).toBeUndefined();
  });
});

describe('joinPackagePath', () => {
  it('joins unless the package dir is the repo root', () => {
    expect(joinPackagePath('.', 'index.html')).toBe('index.html');
    expect(joinPackagePath('dist', 'index.html')).toBe('dist/index.html');
  });
});

describe('resolveMarketCover', () => {
  const ref = { owner: 'alice', repo: 'game-a' };
  it('passes through absolute urls', () => {
    expect(resolveMarketCover(ref, '.', 'https://cdn.example.com/c.png')).toBe('https://cdn.example.com/c.png');
  });
  it('resolves relative paths against the package dir and ref', () => {
    expect(resolveMarketCover(ref, '.', 'cover.png')).toBe(
      'https://github.com/alice/game-a/raw/HEAD/cover.png',
    );
    expect(resolveMarketCover({ ...ref, tag: 'v1.0' }, 'dist', 'cover.png')).toBe(
      'https://github.com/alice/game-a/raw/v1.0/dist/cover.png',
    );
  });
  it('returns undefined without cover', () => {
    expect(resolveMarketCover(ref, '.', undefined)).toBeUndefined();
  });
});
