import { describe, expect, it } from 'vitest';
import {
  createPackage,
  decodeFilesBase64,
  encodeFilesBase64,
  encodeText,
  getRoomHtml,
  normalizePackagePath,
} from './RoomPackage.js';

const manifest = {
  partiVersion: '0.1.0',
  protocolVersion: 1,
  id: 'binary-room',
  name: 'Binary room',
  version: '1.0.0',
  packageMode: 'filesystem',
  entry: { ui: 'index.html', worker: 'room.worker.js' },
};

describe('RoomPackage binary files', () => {
  it('hashes and decodes text entries while preserving binary bytes', async () => {
    const files = {
      'index.html': encodeText('<h1>Hello</h1>'),
      'room.worker.js': encodeText('export default {}'),
      'assets/pixel.png': new Uint8Array([0, 255, 1, 128]),
    };
    const pkg = await createPackage({ manifest, files });
    expect(getRoomHtml(pkg)).toBe('<h1>Hello</h1>');
    expect(pkg.packageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decodeFilesBase64(encodeFilesBase64(files))).toEqual(files);
  });

  it.each(['', '/root', 'a\\b', 'a/../b', 'a/%2e%2e/b', './a', 'a//b', 'a?x=1'])('rejects unsafe path %s', (path) => {
    expect(() => normalizePackagePath(path)).toThrow();
  });
});
