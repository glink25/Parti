import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { RoomSourceError } from './packageSource';
import { GitHubSourceClient, parseGitHubRoomUrl, resolveForTriage, resolveGitHubImport } from './githubSource';

const manifest = {
  partiVersion: '0.1.0', protocolVersion: 1, id: 'room', name: 'Room', version: '1.0.0',
  packageMode: 'blob', entry: { ui: 'index.html', worker: 'room.worker.js' },
};

async function releaseZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('parti.room.json', JSON.stringify(manifest));
  zip.file('index.html', 'ok');
  zip.file('room.worker.js', 'ok');
  return zip.generateAsync({ type: 'uint8array' });
}

describe('GitHub room URLs', () => {
  it('parses repository, tree and blob forms', () => {
    expect(parseGitHubRoomUrl('https://github.com/a/room')).toMatchObject({ kind: 'repository' });
    expect(parseGitHubRoomUrl('https://github.com/a/room/tree/main/dist')).toMatchObject({
      kind: 'tree', refAndPath: ['main', 'dist'],
    });
    expect(parseGitHubRoomUrl('https://github.com/a/room/blob/main/dist/parti.room.json')).toMatchObject({
      kind: 'blob', refAndPath: ['main', 'dist', 'parti.room.json'],
    });
  });

  it('chooses the longest existing ref and scopes to its folder', async () => {
    const client = new GitHubSourceClient({ fetch: vi.fn(async (input) => {
      const url = String(input);
      const found = url.endsWith(`/heads/${encodeURIComponent('feature/room')}`);
      return new Response(found ? '{}' : '', { status: found ? 200 : 404 });
    }) as typeof fetch });
    await expect(client.resolveUrl('https://github.com/a/room/tree/feature/room/dist')).resolves.toMatchObject({
      ref: 'feature/room', scope: 'dist', explicitRef: true,
    });
  });
});

describe('GitHub repository trees', () => {
  const repo = { owner: 'a', repo: 'room' };

  it('uses the jsDelivr tree when available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      files: [{ type: 'directory', name: 'dist', files: [{ type: 'file', name: 'parti.room.json' }] }],
    }), { status: 200 }));
    const client = new GitHubSourceClient({ fetch: fetchMock });
    await expect(client.listPaths(repo, 'main')).resolves.toEqual(['dist/parti.room.json']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to GitHub and distinguishes rate limits and truncation', async () => {
    const success = new GitHubSourceClient({ fetch: vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        truncated: false, tree: [{ type: 'blob', path: 'dist/parti.room.json' }],
      }), { status: 200 })) });
    await expect(success.listPaths(repo, 'main')).resolves.toEqual(['dist/parti.room.json']);

    const limited = new GitHubSourceClient({ fetch: vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 403 })) });
    await expect(limited.listPaths(repo, 'main')).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });

    const truncated = new GitHubSourceClient({ fetch: vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ truncated: true, tree: [] }), { status: 200 })) });
    await expect(truncated.listPaths(repo, 'main')).rejects.toMatchObject({ code: 'GITHUB_TREE_TRUNCATED' });
  });
});

describe('GitHub release fallback', () => {
  it('uses latest only without a ref and an exact tag when a ref is supplied', async () => {
    const fetchMock = vi.fn(async (_input) => new Response(JSON.stringify({
      tag_name: 'v1',
      assets: [{
        name: 'parti.room.zip',
        browser_download_url: 'https://example/room.zip',
      }],
    }), { status: 200 }));
    const client = new GitHubSourceClient({ fetch: fetchMock as typeof fetch });
    await client.releaseFallback({ owner: 'a', repo: 'room' });
    await client.releaseFallback({ owner: 'a', repo: 'room' }, 'v1');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/releases/latest');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/releases/tags/v1');
  });

  it('reports a manual fallback without reading the release ZIP in the browser', async () => {
    const client = {
      resolveUrl: vi.fn().mockResolvedValue({ owner: 'a', repo: 'room', ref: 'main', scope: '.', explicitRef: false }),
      resolveRepository: vi.fn().mockRejectedValue(new Error('missing')),
      releaseFallback: vi.fn().mockResolvedValue({ tag: 'v1', asset: { name: 'parti.room.zip', url: 'https://example/room.zip' } }),
    } as unknown as GitHubSourceClient;
    await expect(resolveGitHubImport('https://github.com/a/room', client)).rejects.toMatchObject({
      code: 'RELEASE_MANUAL_REQUIRED', releaseUrl: 'https://example/room.zip',
    });
  });

  it('allows triage to list a valid release-only package', async () => {
    const client = {
      defaultBranch: vi.fn().mockResolvedValue('main'),
      resolveRepository: vi.fn().mockRejectedValue(new RoomSourceError('NO_COMPLETE_PACKAGE')),
      releaseFallback: vi.fn().mockResolvedValue({
        tag: 'v1', asset: { name: 'parti.room.zip', url: 'https://example/room.zip' },
      }),
    } as unknown as GitHubSourceClient;
    const result = await resolveForTriage(
      { owner: 'a', repo: 'room' },
      client,
      async () => releaseZip(),
    );
    expect(result.metadata.primary).toMatchObject({ kind: 'release-zip', tag: 'v1', manual: true });
    expect(result.manifest).toMatchObject({ id: 'room' });
  });
});
