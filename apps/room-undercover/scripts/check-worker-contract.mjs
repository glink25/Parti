import { readFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = process.env.PARTI_ROOM_BUILD_OUT_DIR
  ?? process.env.PARTI_ROOM_DEV_OUT_DIR
  ?? path.resolve('dist/package');
const worker = await readFile(path.join(outDir, 'worker.js'), 'utf8');

if (!/export\s+default\s+[A-Za-z_$][\w$]*\s*;/.test(worker)) {
  throw new Error('worker.js must contain a default-exported room definition');
}

if (!/import\s*\{\s*defineRoom\s*\}\s*from\s*["']@parti\/worker-sdk["']/.test(worker)) {
  throw new Error('worker.js must preserve the canonical Parti SDK import');
}

if (/from\s*["']\.\.?\//.test(worker)) {
  throw new Error('worker.js must not contain relative imports');
}
