import type { HostRuntime, MessageLogEntry, Player, SnapshotPayload } from '@parti/core';
import type { RoomClientPort } from '@parti/client-sdk';
import type { RoomPackage } from '@parti/room-packager';
import { getReplay, putReplay, putReplayPackage } from './storage';
import type { ReplayRecord, ReplayStep } from './types';
import { createRecordingPort } from './recordingPort';
import { createReplayId } from './replayId';

const SESSION_PREFIX = 'parti:replay-recording:';
type ReplayStepInput = ReplayStep extends infer Step
  ? Step extends ReplayStep
    ? Omit<Step, 'index' | 'at'>
    : never
  : never;

export interface ReplayRecordingController {
  port: RoomClientPort;
  stop(): Promise<void>;
}

export async function startReplayRecording(options: {
  host: HostRuntime;
  port: RoomClientPort;
  pkg: RoomPackage;
  title: string;
  onError?: (error: Error) => void;
}): Promise<ReplayRecordingController> {
  const { host, pkg } = options;
  const sessionKey = SESSION_PREFIX + host.roomId;
  const previousId = sessionStorage.getItem(sessionKey);
  const previous = previousId ? await getReplay(previousId) : undefined;
  const now = Date.now();
  const record: ReplayRecord = previous?.status === 'recording'
    ? { ...previous, title: options.title, updatedAt: now }
    : {
        id: createReplayId(),
        roomId: host.roomId,
        roomName: pkg.manifest.name,
        title: options.title,
        packageHash: pkg.packageHash,
        hostPlayerId: host.getHostPlayerId(),
        startedAt: now,
        updatedAt: now,
        status: 'recording',
        steps: [],
      };

  await putReplayPackage({ hash: pkg.packageHash, packageHash: pkg.packageHash, manifest: pkg.manifest, files: pkg.files });
  sessionStorage.setItem(sessionKey, record.id);

  let active = true;
  let lastVersion = record.steps.reduce((version, step) =>
    step.kind === 'snapshot' ? Math.max(version, step.snapshot.version) : version, -1);
  let queue = Promise.resolve();
  const unsubscribers: Array<() => void> = [];

  const fail = (reason: unknown) => {
    if (!active) return;
    active = false;
    sessionStorage.removeItem(sessionKey);
    for (const off of unsubscribers.splice(0)) off();
    options.onError?.(reason instanceof Error ? reason : new Error(String(reason)));
  };

  const append = (step: ReplayStepInput, at = Date.now()) => {
    if (!active) return;
    try {
      const safe = structuredClone(step) as ReplayStepInput;
      record.steps.push({ ...safe, index: record.steps.length, at } as ReplayStep);
      record.updatedAt = at;
      queue = queue.then(() => putReplay(record)).catch(fail);
    } catch (error) {
      fail(error);
    }
  };

  const appendSnapshot = (snapshot: SnapshotPayload) => {
    if (snapshot.version === lastVersion) return;
    lastVersion = snapshot.version;
    append({ kind: 'snapshot', snapshot });
  };

  if (!previous || record.steps.length === 0) appendSnapshot(host.currentSnapshot());
  if (!previous || record.steps.length <= 1) append({ kind: 'players', players: host.listPlayers() });
  unsubscribers.push(host.localState.on(appendSnapshot));
  unsubscribers.push(host.localEvent.on(({ event, payload }) => append({ kind: 'event', event, payload })));
  unsubscribers.push(host.playersChanged.on((players: Player[]) => append({ kind: 'players', players })));
  unsubscribers.push(host.messageLog.on((entry: MessageLogEntry) => {
    if (entry.message.type === 'game:action') {
      const payload = entry.message.payload as { action: string; payload: unknown };
      append({ kind: 'action', playerId: entry.message.from, action: payload.action, payload: payload.payload }, entry.at);
      return;
    }
    if (entry.message.channel === 'sys') {
      append({ kind: 'message', direction: entry.dir, message: entry.message }, entry.at);
    }
  }));

  const port = createRecordingPort(options.port, (action, payload) => {
    append({ kind: 'action', playerId: host.getHostPlayerId(), action, payload });
  });

  await queue;
  return {
    port,
    async stop() {
      if (!active) return;
      active = false;
      for (const off of unsubscribers.splice(0)) off();
      sessionStorage.removeItem(sessionKey);
      record.status = 'completed';
      record.endedAt = Date.now();
      record.updatedAt = record.endedAt;
      await queue;
      await putReplay(record);
    },
  };
}
