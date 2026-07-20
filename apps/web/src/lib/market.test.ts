import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomManifest } from '@parti/room-packager';
import {
  assertMarketPackageEntries,
  findCompleteMarketPackageDir,
  listMarketPackagePaths,
} from './market';

const repo = { owner: 'alice', repo: 'game-a' };
const manifest: RoomManifest = {
  partiVersion: '0.1.0',
  protocolVersion: 1,
  id: 'game-a',
  name: 'Game A',
  version: '1.0.0',
  packageMode: 'blob',
  entry: { ui: 'index.html', worker: 'room.worker.js' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('market repository trees', () => {
  it('uses the jsDelivr tree when available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      files: [{
        type: 'directory',
        name: 'dist',
        files: [
          { type: 'file', name: 'parti.room.json' },
          { type: 'file', name: 'index.html' },
        ],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listMarketPackagePaths(repo, 'main')).resolves.toEqual([
      'dist/parti.room.json',
      'dist/index.html',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the GitHub recursive tree', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        truncated: false,
        tree: [
          { type: 'tree', path: 'dist' },
          { type: 'blob', path: 'dist/parti.room.json' },
          { type: 'blob', path: 'dist/index.html' },
        ],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listMarketPackagePaths(repo, 'main')).resolves.toEqual([
      'dist/parti.room.json',
      'dist/index.html',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports GitHub rate limiting during fallback', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 403 })));

    await expect(listMarketPackagePaths(repo, 'main')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 403,
    });
  });

  it('rejects a truncated GitHub tree', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ truncated: true, tree: [] }), { status: 200 })));

    await expect(listMarketPackagePaths(repo, 'main')).rejects.toMatchObject({
      code: 'PACKAGE_TREE_TRUNCATED',
    });
  });
});

describe('market package completeness', () => {
  it('accepts a complete declared package directory', () => {
    expect(() => assertMarketPackageEntries([
      'dist/parti.room.json',
      'dist/index.html',
      'dist/room.worker.js',
    ], 'dist', manifest)).not.toThrow();
  });

  it('reports the missing declared entry instead of a ZIP parsing error', () => {
    expect(() => assertMarketPackageEntries([
      'public/parti.room.json',
      'public/cover.png',
    ], 'public', manifest)).toThrowError(expect.objectContaining({
      code: 'PACKAGE_ENTRY_MISSING',
      path: 'index.html',
    }));
  });

  it('skips a stale manifest-only public directory and selects a complete dist package', () => {
    expect(findCompleteMarketPackageDir([
      'public/parti.room.json',
      'public/cover.png',
      'dist/parti.room.json',
      'dist/index.html',
      'dist/room.worker.js',
    ], manifest, 'public')).toBe('dist');
  });
});
