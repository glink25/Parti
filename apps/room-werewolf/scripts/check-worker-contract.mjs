import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../dist/worker.js', import.meta.url), 'utf8');
if (!source.includes('defineRoom')) throw new Error('Worker bundle must retain defineRoom contract');
if (!source.includes('initialState')) throw new Error('Worker bundle must define initialState');
console.log('worker contract ok');
