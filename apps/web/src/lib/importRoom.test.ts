import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildPackageInputFromFiles, unzipRoomPackage } from './importRoom';

const manifest = {
  partiVersion: '0.1.0',
  protocolVersion: 1,
  id: 'zip-test',
  name: 'ZIP Test',
  version: '1.0.0',
  packageMode: 'blob' as const,
  cover: 'assets/cover.png',
  entry: { ui: 'index.html', worker: 'room.worker.js' },
};

async function roomZip(prefix = '', html = '<main>ok</main>'): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(`${prefix}parti.room.json`, JSON.stringify(manifest));
  zip.file(`${prefix}index.html`, html);
  zip.file(`${prefix}room.worker.js`, 'export default {};');
  zip.file(`${prefix}assets/cover.png`, new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('room ZIP import', () => {
  it('imports a root package with a large UI entry and relative cover', async () => {
    const html = `<main>${'x'.repeat(600_000)}</main>`;
    const files = await unzipRoomPackage(await roomZip('', html));
    const input = await buildPackageInputFromFiles(files);

    expect(Object.keys(input.files).sort()).toEqual([
      'assets/cover.png',
      'index.html',
      'room.worker.js',
    ]);
    expect(input.files['index.html']).toHaveLength(html.length);
    expect(input.files['assets/cover.png']).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('strips one package wrapper directory without losing entry files', async () => {
    const files = await unzipRoomPackage(await roomZip('release/'));
    const input = await buildPackageInputFromFiles(files);

    expect(input.manifest).toEqual(expect.objectContaining({
      entry: { ui: 'index.html', worker: 'room.worker.js' },
    }));
    expect(input.files['index.html']).toBeDefined();
    expect(input.files['room.worker.js']).toBeDefined();
  });
});
