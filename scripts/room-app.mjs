import { readFile } from 'node:fs/promises';
import path from 'node:path';

const APP_NAME_PATTERN = /^(template|room)-[a-z0-9][a-z0-9_-]*$/;
const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

async function readJson(file, label, rootDir) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${label} at ${path.relative(rootDir, file)}: ${detail}`);
  }
}

export async function loadRoomApp(rootDir, appName, requiredScript) {
  const match = APP_NAME_PATTERN.exec(appName);
  if (!match) {
    throw new Error(`Invalid Room app name: ${appName}. Expected template-<name> or room-<name>`);
  }

  const kind = match[1];
  const appDir = path.join(rootDir, 'apps', appName);
  const packagePath = path.join(appDir, 'package.json');
  const manifestPath = path.join(appDir, 'public', 'parti.room.json');
  const packageJson = await readJson(packagePath, 'package.json', rootDir);
  const manifest = await readJson(manifestPath, 'parti.room.json', rootDir);

  if (!packageJson.scripts?.[requiredScript]) {
    throw new Error(`${path.relative(rootDir, packagePath)} must define a ${requiredScript} script`);
  }
  if (typeof manifest.id !== 'string' || !ROOM_ID_PATTERN.test(manifest.id)) {
    throw new Error('The Room manifest id must contain only lowercase letters, numbers, "-", or "_"');
  }
  if (kind === 'template' && !manifest.id.startsWith('dev-')) {
    throw new Error('A template-* development manifest id must start with "dev-"');
  }

  return {
    appName,
    appDir,
    kind,
    manifest,
    outputName: kind === 'room' ? appName : manifest.id,
  };
}
