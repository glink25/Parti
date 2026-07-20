import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  RoomSourceError,
  findRoomPackageCandidate,
  resolveRoomPackageFiles,
  resolveRoomPackageZip,
} from './packageSource';

const baseManifest = {
  partiVersion: '0.1.0', protocolVersion: 1, id: 'room', name: 'Room', version: '1.0.0',
  packageMode: 'blob', entry: { ui: 'index.html', worker: 'room.worker.js' },
};

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('room package candidate selection', () => {
  it('skips an incomplete shallow manifest and selects a complete deeper package', async () => {
    const files: Record<string, Uint8Array> = {
      'public/parti.room.json': bytes(JSON.stringify(baseManifest)),
      'public/cover.png': new Uint8Array([1]),
      'dist/parti.room.json': bytes(JSON.stringify(baseManifest)),
      'dist/index.html': bytes('ok'),
      'dist/room.worker.js': bytes('ok'),
    };
    const candidate = await findRoomPackageCandidate(Object.keys(files), async (path) => files[path]);
    expect(candidate.packageDir).toBe('dist');
  });

  it('checks optional client and style entries', async () => {
    const manifest = { ...baseManifest, entry: { ...baseManifest.entry, client: 'client.js', style: 'style.css' } };
    const files: Record<string, Uint8Array> = {
      'parti.room.json': bytes(JSON.stringify(manifest)),
      'index.html': bytes('ok'),
      'room.worker.js': bytes('ok'),
      'client.js': bytes('ok'),
    };
    await expect(findRoomPackageCandidate(Object.keys(files), async (path) => files[path]))
      .rejects.toMatchObject({ code: 'NO_COMPLETE_PACKAGE', failures: [{ path: 'style.css' }] });
  });

  it('limits selection to the requested folder', async () => {
    const files: Record<string, Uint8Array> = {
      'one/parti.room.json': bytes(JSON.stringify(baseManifest)),
      'one/index.html': bytes('ok'),
      'one/room.worker.js': bytes('ok'),
      'two/parti.room.json': bytes(JSON.stringify({ ...baseManifest, id: 'two' })),
      'two/index.html': bytes('ok'),
      'two/room.worker.js': bytes('ok'),
    };
    const result = await resolveRoomPackageFiles(Object.keys(files), async (path) => files[path], 'two');
    expect(result.input.manifest).toMatchObject({ id: 'two' });
  });

  it('does not misreport a manifest download failure as invalid JSON', async () => {
    await expect(findRoomPackageCandidate(
      ['parti.room.json'],
      async () => { throw new RoomSourceError('GITHUB_DOWNLOAD_FAILED', { status: 503 }); },
    )).rejects.toMatchObject({ code: 'GITHUB_DOWNLOAD_FAILED', status: 503 });
  });
});

describe('room ZIP resolution', () => {
  it.each(['', 'wrapper/', 'outer/wrapper/'])('resolves a package under prefix %s', async (prefix) => {
    const zip = new JSZip();
    zip.file(`${prefix}parti.room.json`, JSON.stringify(baseManifest));
    zip.file(`${prefix}index.html`, 'ok');
    zip.file(`${prefix}room.worker.js`, 'ok');
    const result = await resolveRoomPackageZip(await zip.generateAsync({ type: 'uint8array' }));
    expect(result.candidate.packageDir).toBe(prefix.replace(/\/$/, '') || '.');
    expect(result.input.files['index.html']).toBeDefined();
  });

  it('rejects an unsafe archive path', async () => {
    const zip = new JSZip();
    zip.file('../parti.room.json', JSON.stringify(baseManifest));
    await expect(resolveRoomPackageZip(await zip.generateAsync({ type: 'uint8array' })))
      .rejects.toMatchObject({ code: 'SOURCE_PATH_INVALID' });
  });
});
