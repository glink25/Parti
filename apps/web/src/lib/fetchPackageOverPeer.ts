/**
 * joiner 端取包 —— 经 Host 点对点下载房间代码包 (GOAL §11.1, §8.5)。
 */
import {
  PARTI_VERSION,
  SeqCounter,
  createMessage,
  type ClientTransportSession,
  type PackageDataPayload,
  type PackageRequestPayload,
  type RoomErrorPayload,
  type RoomMessage,
} from '@parti/core';
import { createPackage, decodeFilesBase64, type RoomPackage } from '@parti/room-packager';
import { createTransportAdapter, type TransportConfig } from './transportConfig';

const PACKAGE_FETCH_TIMEOUT_MS = 15_000;

export type FetchPackageErrorCode = 'timeout' | 'disconnected';

export class FetchPackageError extends Error {
  readonly code: FetchPackageErrorCode;

  constructor(code: FetchPackageErrorCode) {
    super(code);
    this.name = 'FetchPackageError';
    this.code = code;
  }
}

export async function fetchPackageOverPeer(
  roomId: string,
  hostPeerId: string,
  options: { clientId?: string; credential?: string; transportConfig?: TransportConfig } = {},
): Promise<RoomPackage> {
  const adapter = await createTransportAdapter(options.transportConfig ?? { adapter: 'peerjs' });
  const transport = await adapter.joinRoom({
    roomId,
    hostConnectionInfo: hostPeerId,
  });

  try {
    const data = await requestPackageData(transport, roomId, options);
    return await createPackage({ manifest: data.manifest, files: decodeFilesBase64(data.files) });
  } finally {
    transport.close();
  }
}

function requestPackageData(
  transport: ClientTransportSession,
  roomId: string,
  options: { clientId?: string; credential?: string },
): Promise<PackageDataPayload> {
  return new Promise<PackageDataPayload>((resolve, reject) => {
    const seq = new SeqCounter();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new FetchPackageError('timeout'));
    }, PACKAGE_FETCH_TIMEOUT_MS);

    transport.onMessage((tm) => {
      const message = tm.data as RoomMessage;
      if (settled) return;
      if (message.type === 'sys:package-data') {
        settled = true;
        clearTimeout(timer);
        resolve(message.payload as PackageDataPayload);
      } else if (message.type === 'sys:error') {
        settled = true;
        clearTimeout(timer);
        const error = message.payload as RoomErrorPayload;
        reject(Object.assign(new Error(error.message), { code: error.code }));
      }
    });

    transport.onDisconnect(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new FetchPackageError('disconnected'));
    });

    const payload: PackageRequestPayload = {
      partiVersion: PARTI_VERSION,
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.credential !== undefined ? { credential: options.credential } : {}),
    };
    const request: RoomMessage = createMessage({
      roomId,
      from: transport.selfId,
      to: transport.hostId,
      seq: seq.next(),
      channel: 'sys',
      type: 'sys:package-request',
      payload,
    });
    transport.send({ data: request, meta: { reliable: true, ordered: true } });
  });
}
