import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadRoomApp } from './room-app.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roomApp = process.argv[2];

function fail(message) {
  console.error(`[room:dev] ${message}`);
  process.exit(1);
}

if (!roomApp) fail('Usage: pnpm room:dev <room-app>');
const room = await loadRoomApp(rootDir, roomApp, 'dev:room').catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
const outputDir = path.join(rootDir, 'apps', 'web', 'public', 'rooms', room.outputName);
await rm(outputDir, { recursive: true, force: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [
  spawn(pnpm, ['--filter', '@parti/web', 'dev', '--host'], {
    cwd: rootDir,
    stdio: 'inherit',
  }),
  spawn(pnpm, ['run', 'dev:room'], {
    cwd: room.appDir,
    stdio: 'inherit',
    env: { ...process.env, PARTI_ROOM_DEV_OUT_DIR: outputDir },
  }),
];

console.log(`[room:dev] ${roomApp} -> /rooms/${room.outputName}/ (id: ${room.manifest.id})`);

let shuttingDown = false;
let exitCode = 0;
let closed = 0;
let forceStopTimer;

async function finish() {
  if (forceStopTimer) clearTimeout(forceStopTimer);
  await rm(outputDir, { recursive: true, force: true });
  process.exit(exitCode);
}

function stop(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  forceStopTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 5000);
  forceStopTimer.unref();
  if (closed === children.length) void finish();
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`[room:dev] Failed to start child process: ${error.message}`);
    stop(1);
  });
  child.on('close', (code, signal) => {
    closed += 1;
    if (!shuttingDown) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      console.error(`[room:dev] A child process exited with ${reason}`);
      stop(code ?? 1);
    }
    if (shuttingDown && closed === children.length) void finish();
  });
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
