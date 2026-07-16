import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest';

const baseManifest = {
  partiVersion: '0.1.0',
  protocolVersion: 1,
  id: 'sensor-room',
  name: 'Sensor room',
  version: '1.0.0',
  packageMode: 'filesystem',
  entry: { ui: 'index.html', worker: 'room.worker.js' },
};

describe('manifest sensor permissions', () => {
  it('accepts supported sensor declarations', () => {
    expect(validateManifest({
      ...baseManifest,
      permissions: { sensors: ['accelerometer', 'gyroscope', 'magnetometer'] },
    }).permissions?.sensors).toEqual(['accelerometer', 'gyroscope', 'magnetometer']);
  });

  it.each([
    'gyroscope',
    ['proximity'],
    ['gyroscope', 'gyroscope'],
  ])('rejects invalid sensor declaration %j', (sensors) => {
    expect(() => validateManifest({
      ...baseManifest,
      permissions: { sensors },
    })).toThrow(/permissions\.sensors/);
  });
});

describe('manifest tags', () => {
  it('accepts unique non-empty tag ids', () => {
    expect(validateManifest({ ...baseManifest, tags: ['party', 'turn-based'] }).tags)
      .toEqual(['party', 'turn-based']);
  });

  it.each(['party', ['party', ''], ['party', 'party']])(
    'rejects invalid tags declaration %j',
    (tags) => expect(() => validateManifest({ ...baseManifest, tags })).toThrow(/manifest\.tags/),
  );
});
