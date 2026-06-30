import { describe, expect, it } from 'vitest';
import {
  ClientRuntime,
  HostRuntime,
  PARTI_VERSION,
  type RoomAdmissionController,
  type RoomErrorPayload,
  createMessage,
  SeqCounter,
} from '@parti/core';
import { LocalTransportAdapter } from '@parti/transport-local';
import { InProcessWorkerHost } from '@parti/worker-sdk';

const ROOM_ID = 'admission-room';
const PACKAGE_HASH = 'admission-hash';
const SOURCE = `
export default defineRoom({
  initialState() { return { joins: 0 }; },
  onJoin(ctx) { ctx.state.joins += 1; },
});
`;

async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function passwordController(password: string): RoomAdmissionController {
  return {
    authorize(request) {
      if (!request.credential) {
        return {
          allowed: false,
          code: 'CREDENTIAL_REQUIRED',
          message: '需要密码',
        };
      }
      return request.credential === password
        ? { allowed: true }
        : {
            allowed: false,
            code: 'INVALID_CREDENTIAL',
            message: '密码错误',
          };
    },
  };
}

async function setup(maxPlayers = 2) {
  const adapter = new LocalTransportAdapter();
  const transport = await adapter.createHost({ roomId: ROOM_ID });
  const host = new HostRuntime({
    roomId: ROOM_ID,
    partiVersion: PARTI_VERSION,
    packageHash: PACKAGE_HASH,
    transport,
    worker: new InProcessWorkerHost(),
    roomSource: SOURCE,
    admissionController: passwordController('1234'),
    maxPlayers,
    manifest: { id: ROOM_ID },
    packageFiles: { 'index.html': '<p>private package</p>' },
  });
  await host.start();
  return { adapter, host };
}

async function join(
  adapter: LocalTransportAdapter,
  options: { clientId: string; credential?: string },
) {
  const transport = await adapter.joinRoom({
    roomId: ROOM_ID,
    hostConnectionInfo: ROOM_ID,
  });
  const client = new ClientRuntime({
    roomId: ROOM_ID,
    partiVersion: PARTI_VERSION,
    packageHash: PACKAGE_HASH,
    transport,
    clientId: options.clientId,
    ...(options.credential !== undefined
      ? { credential: options.credential }
      : {}),
  });
  const errors: RoomErrorPayload[] = [];
  client.errors.on((error) => errors.push(error));
  await client.start();
  await flush();
  return { client, errors };
}

describe('HostRuntime admission', () => {
  it('protects package download before the formal join handshake', async () => {
    const { adapter, host } = await setup(3);
    const transport = await adapter.joinRoom({
      roomId: ROOM_ID,
      hostConnectionInfo: ROOM_ID,
    });
    const messages: Array<{ type: string; code?: string }> = [];
    transport.onMessage((transportMessage) => {
      const message = transportMessage.data as {
        type: string;
        payload?: RoomErrorPayload;
      };
      messages.push({ type: message.type, code: message.payload?.code });
    });
    const seq = new SeqCounter();
    const sendRequest = (credential?: string) => transport.send({
      data: createMessage({
        roomId: ROOM_ID,
        from: transport.selfId,
        to: transport.hostId,
        seq: seq.next(),
        channel: 'sys',
        type: 'sys:package-request',
        payload: {
          partiVersion: PARTI_VERSION,
          ...(credential ? { credential } : {}),
        },
      }),
    });

    sendRequest();
    await flush();
    sendRequest('1234');
    await flush();

    expect(messages).toContainEqual({
      type: 'sys:error',
      code: 'CREDENTIAL_REQUIRED',
    });
    expect(messages.some((message) => message.type === 'sys:package-data')).toBe(true);
    host.dispose();
  });

  it('rejects missing and invalid credentials without joining the worker', async () => {
    const { adapter, host } = await setup(3);
    const missing = await join(adapter, { clientId: 'missing' });
    const invalid = await join(adapter, {
      clientId: 'invalid',
      credential: '9999',
    });

    expect(missing.errors[0]?.code).toBe('CREDENTIAL_REQUIRED');
    expect(invalid.errors[0]?.code).toBe('INVALID_CREDENTIAL');
    expect(host.listPlayers()).toHaveLength(1);
    expect(host.currentSnapshot().state).toEqual({ joins: 1 });
    host.dispose();
  });

  it('accepts a valid credential, enforces capacity, and emits status', async () => {
    const { adapter, host } = await setup(2);
    const statuses: boolean[] = [];
    host.admissionStatusChanged.on((status) => statuses.push(status.joinable));

    const accepted = await join(adapter, {
      clientId: 'accepted',
      credential: '1234',
    });
    const full = await join(adapter, {
      clientId: 'full',
      credential: '1234',
    });

    expect(accepted.client.isWelcomed).toBe(true);
    expect(full.errors[0]?.code).toBe('ROOM_FULL');
    expect(host.getAdmissionStatus()).toMatchObject({
      activePlayers: 2,
      reservedPlayers: 2,
      maxPlayers: 2,
      joinable: false,
    });
    expect(statuses).toContain(false);
    host.dispose();
  });

  it('allows reconnecting identities and supports replacing the controller', async () => {
    const { adapter, host } = await setup(2);
    const first = await join(adapter, {
      clientId: 'returning',
      credential: '1234',
    });
    const playerId = first.client.getPlayerId();
    first.client.leave();
    await flush();

    host.setAdmissionController(passwordController('5678'));
    const returning = await join(adapter, { clientId: 'returning' });

    expect(returning.client.getPlayerId()).toBe(playerId);
    expect(returning.errors).toEqual([]);
    host.dispose();
  });

  it('redacts credentials from host and client message logs', async () => {
    const { adapter, host } = await setup(2);
    const hostLogs: unknown[] = [];
    host.messageLog.on((entry) => hostLogs.push(entry.message.payload));
    const transport = await adapter.joinRoom({
      roomId: ROOM_ID,
      hostConnectionInfo: ROOM_ID,
    });
    const client = new ClientRuntime({
      roomId: ROOM_ID,
      partiVersion: PARTI_VERSION,
      packageHash: PACKAGE_HASH,
      transport,
      clientId: 'logged',
      credential: '1234',
    });
    const clientLogs: unknown[] = [];
    client.messageLog.on((entry) => clientLogs.push(entry.message.payload));
    await client.start();
    await flush();

    expect(JSON.stringify(hostLogs)).not.toContain('1234');
    expect(JSON.stringify(clientLogs)).not.toContain('1234');
    expect(JSON.stringify(clientLogs)).toContain('[REDACTED]');
    host.dispose();
  });
});
