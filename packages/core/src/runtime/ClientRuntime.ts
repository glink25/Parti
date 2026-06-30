/**
 * ClientRuntime —— 玩家端 (GOAL.md §8.5, §10.3)。
 *
 * 连接 Host（经 ClientTransportSession），完成 hello/welcome 握手，
 * 接收 state:snapshot / game:event，并向 UI 暴露简洁的订阅接口。
 * 玩家只提交意图（game:action），不直接修改最终状态（§6.1 Host Authoritative）。
 */
import { generateId, SeqCounter } from '../protocol/factory.js';
import {
  PROTOCOL_VERSION,
  type EventPayload,
  type HelloPayload,
  type RoomErrorPayload,
  type RoomMessage,
  type SnapshotPayload,
  type WelcomePayload,
  redactRoomMessage,
} from '../protocol/messages.js';
import { ClientStateCache } from '../state/sync.js';
import type {
  ClientTransportSession,
  TransportMessage,
} from '../transport/types.js';
import { Emitter } from '../util/emitter.js';
import type { ConnectionStatus, MessageLogEntry } from './types.js';

export interface ClientRuntimeOptions {
  roomId: string;
  partiVersion: string;
  packageHash: string;
  transport: ClientTransportSession;
  playerName?: string;
  /** 稳定客户端身份 id（跨刷新/掉线），重连时凭此复用原玩家身份。 */
  clientId?: string;
  /** 宿主层提供的 opaque 准入凭据，不会进入 Room Worker。 */
  credential?: string;
}

export class ClientRuntime {
  readonly roomId: string;
  private readonly opts: ClientRuntimeOptions;
  private readonly transport: ClientTransportSession;
  private readonly cache = new ClientStateCache();
  private readonly seq = new SeqCounter();

  private playerId = '';
  private welcomed = false;
  private status: ConnectionStatus = 'idle';

  readonly stateChanged = new Emitter<SnapshotPayload>();
  readonly event = new Emitter<EventPayload>();
  readonly welcome = new Emitter<WelcomePayload>();
  readonly errors = new Emitter<RoomErrorPayload>();
  readonly statusChanged = new Emitter<ConnectionStatus>();
  readonly messageLog = new Emitter<MessageLogEntry>();

  constructor(options: ClientRuntimeOptions) {
    this.opts = options;
    this.roomId = options.roomId;
    this.transport = options.transport;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  getState<T = unknown>(): T | null {
    return this.cache.getState<T>();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** 建立监听并发送 sys:hello。 */
  async start(): Promise<void> {
    this.setStatus('connecting');
    this.transport.onMessage((tm) => this.onMessage(tm));
    this.transport.onDisconnect((reason) => this.onDisconnect(reason));

    const hello: HelloPayload = {
      partiVersion: this.opts.partiVersion,
      protocolVersion: PROTOCOL_VERSION,
      roomPackageHash: this.opts.packageHash,
      player: {
        name: this.opts.playerName ?? 'Player',
        ...(this.opts.clientId ? { clientId: this.opts.clientId } : {}),
      },
      capabilities: { binary: false, compression: false, patch: false },
      ...(this.opts.credential !== undefined
        ? { admission: { credential: this.opts.credential } }
        : {}),
    };
    this.send('sys', 'sys:hello', hello);
  }

  /** 玩家就绪 (§8.5 step 9)。 */
  ready(): void {
    this.send('sys', 'sys:ready', { });
  }

  /** 提交一个 action 意图 (§8.8)。 */
  submitAction(action: string, payload: unknown): string {
    const clientActionId = generateId('action');
    this.send('input', 'game:action', { action, payload, clientActionId });
    return clientActionId;
  }

  requestResync(): void {
    this.send('sys', 'sys:resync-request', {});
  }

  leave(): void {
    this.send('sys', 'sys:leave', {});
    this.transport.close();
    this.setStatus('closed');
  }

  // --- 入站 ---

  private onMessage(tm: TransportMessage): void {
    const message = tm.data as RoomMessage;
    this.messageLog.emit({ dir: 'in', message: redactRoomMessage(message), at: Date.now() });
    switch (message.type) {
      case 'sys:welcome': {
        const welcome = message.payload as WelcomePayload;
        this.playerId = welcome.playerId;
        this.welcomed = true;
        this.setStatus('connected');
        this.welcome.emit(welcome);
        break;
      }
      case 'state:snapshot': {
        const snapshot = message.payload as SnapshotPayload;
        if (this.cache.applySnapshot(snapshot)) {
          this.stateChanged.emit(snapshot);
        }
        break;
      }
      case 'game:event':
        this.event.emit(message.payload as EventPayload);
        break;
      case 'sys:error':
        this.errors.emit(message.payload as RoomErrorPayload);
        break;
      case 'sys:kick':
        this.errors.emit({
          code: 'FORBIDDEN',
          message: '你已被移出房间',
          recoverable: false,
          detail: message.payload,
        });
        this.transport.close();
        this.setStatus('closed');
        break;
      case 'sys:ping':
        this.send('sys', 'sys:pong', {});
        break;
      default:
        break;
    }
  }

  private onDisconnect(reason?: string): void {
    this.setStatus('closed');
    this.errors.emit({
      code: 'HOST_CLOSED',
      message: reason ?? 'Host 连接已断开',
      recoverable: true,
    });
  }

  private send(channel: RoomMessage['channel'], type: string, payload: unknown): void {
    const message: RoomMessage = {
      v: 1,
      id: generateId(),
      roomId: this.roomId,
      from: this.playerId || this.transport.selfId,
      to: this.transport.hostId,
      seq: this.seq.next(),
      channel,
      type,
      ts: Date.now(),
      payload,
    };
    this.transport.send({ data: message, meta: { reliable: true, ordered: true } });
    this.messageLog.emit({ dir: 'out', message: redactRoomMessage(message), at: Date.now() });
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusChanged.emit(status);
  }

  get isWelcomed(): boolean {
    return this.welcomed;
  }

  dispose(): void {
    this.stateChanged.clear();
    this.event.clear();
    this.welcome.clear();
    this.errors.clear();
    this.statusChanged.clear();
    this.messageLog.clear();
  }
}
