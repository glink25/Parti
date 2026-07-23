import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import type { RoomClientPort } from '@parti/client-sdk';
import type { RoomPackage } from '@parti/room-packager';
import { RoomFrame } from '../components/RoomFrame';
import {
  createPeerJoin,
  clearRoomSession,
} from '../lib/PeerRoomSession';
import { FetchPackageError, fetchPackageOverPeer } from '../lib/fetchPackageOverPeer';
import { formatFetchPackageError } from '@/i18n/formatErrors';
import { loadLocalUser } from '../lib/localUser';
import { useLocale } from '@/i18n/LocaleProvider';
import type { TransportConfig } from '../lib/transportConfig';

/**
 * AI agent 接入视图（agent 路由）。
 *
 * 与普通玩家一样通过 transport 加入房间，但额外：
 *  - 以 agent 模式渲染房间 iframe（触发房间的 parti.exposeToAgent 转述）；
 *  - 在宿主页顶层 window 暴露 window.__partiAgent，供无头浏览器 agent 直接从
 *    控制台/evaluate 读取 state、describe，并执行 action 游玩；
 *  - 把 state / guide / 事件同步镜像成页面文本，兼容"只读 DOM/截图"的 agent。
 *
 * 不改动 worker 与核心协议：agent 标志纯客户端，只影响本客户端 UI 与桥接。
 */

export type AgentConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';

export interface PartiAgentBridge {
  /** 契约版本，便于 prompt/agent 侧做兼容判断。 */
  readonly version: number;
  /** 当前连接状态。 */
  status(): AgentConnectionStatus;
  /** 本 agent 的玩家 id（连接完成前为 null）。 */
  playerId(): string | null;
  /** 最新一次错误信息（无则 null）。 */
  error(): string | null;
  /** 当前完整游戏 state（权威快照，只读）。 */
  getState(): unknown;
  /** 每次 state 变化 +1，agent 可轮询它判断是否需要重读。 */
  stateVersion: number;
  /**
   * 房间通过 parti.exposeToAgent 提供的"转述"：面向 AI 的规则/阶段/可用操作/
   * 取值范围说明。房间未提供时为 null，此时请直接读 getState() 自行推断。
   */
  describe(): unknown;
  /** 提交一次玩家意图。返回 { ok:true } 仅代表"已发出"，成败请看 state/事件。 */
  action(action: string, payload?: unknown): { ok: true };
  /** 标记就绪（很多房间在所有人 ready 后才开始）。幂等。 */
  ready(): void;
  /** 取出并清空自上次调用以来缓冲的一次性事件。 */
  drainEvents(): Array<{ event: string; payload: unknown; ts: number }>;
  /** 主动离开房间。 */
  leave(): void;
}

declare global {
  interface Window {
    __partiAgent?: PartiAgentBridge;
  }
}

const AGENT_BRIDGE_VERSION = 1;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function AgentRoomView({
  roomId,
  hostPeerId,
  transportConfig,
  initialCredential,
}: {
  roomId?: string;
  hostPeerId?: string;
  transportConfig: TransportConfig;
  initialCredential?: string;
}) {
  const intl = useIntl();
  const { locale } = useLocale();
  const [pkg, setPkg] = useState<RoomPackage | null>(null);
  const [port, setPort] = useState<RoomClientPort | null>(null);
  const [status, setStatus] = useState<AgentConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  // 渲染用镜像
  const [stateJson, setStateJson] = useState<string>('null');
  const [guideJson, setGuideJson] = useState<string>('null');
  const [eventCount, setEventCount] = useState(0);
  const [stateVersion, setStateVersion] = useState(0);

  // window.__partiAgent 方法读取的实时引用
  const portRef = useRef<RoomClientPort | null>(null);
  const stateRef = useRef<unknown>(null);
  const guideRef = useRef<unknown>(null);
  const eventsRef = useRef<Array<{ event: string; payload: unknown; ts: number }>>([]);
  const statusRef = useRef<AgentConnectionStatus>('connecting');
  const errorRef = useRef<string | null>(null);
  const versionRef = useRef(0);

  const started = useRef(false);

  // agent 可通过链接的 ?name= 参数给自己设置一个独特简洁的名字。
  const agentName = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('name') ?? undefined;

  // 尽早挂上桥：即使还在连接，agent 也能轮询 status()。
  useEffect(() => {
    const bridge: PartiAgentBridge = {
      version: AGENT_BRIDGE_VERSION,
      status: () => statusRef.current,
      playerId: () => {
        try {
          return portRef.current?.getPlayerId() || null;
        } catch {
          return null;
        }
      },
      error: () => errorRef.current,
      getState: () => stateRef.current,
      stateVersion: 0,
      describe: () => guideRef.current,
      action: (action, payload) => {
        portRef.current?.submitAction(action, payload ?? null);
        return { ok: true };
      },
      ready: () => portRef.current?.ready(),
      drainEvents: () => eventsRef.current.splice(0, eventsRef.current.length),
      leave: () => portRef.current?.leave(),
    };
    window.__partiAgent = bridge;
    return () => {
      if (window.__partiAgent === bridge) delete window.__partiAgent;
    };
  }, []);

  // 加入房间（与普通玩家同一路径）
  useEffect(() => {
    if (started.current || !roomId || !hostPeerId) return;
    started.current = true;
    const user = loadLocalUser(undefined, locale);
    fetchPackageOverPeer(roomId, hostPeerId, {
      clientId: user.id,
      transportConfig,
      ...(initialCredential ? { credential: initialCredential } : {}),
    })
      .then((loadedPkg) => {
        const joined = createPeerJoin(
          loadedPkg,
          hostPeerId,
          transportConfig,
          {
            onStatus: (next) => {
              const mapped: AgentConnectionStatus =
                next === 'connected' ? 'connected' : next === 'closed' ? 'closed' : 'connecting';
              statusRef.current = mapped;
              setStatus(mapped);
            },
            onFatal: (message) => {
              errorRef.current = message;
              statusRef.current = 'error';
              setError(message);
              setStatus('error');
            },
          },
          initialCredential || undefined,
          agentName,
        );
        portRef.current = joined.port;
        setPkg(loadedPkg);
        setPort(joined.port);
      })
      .catch((reason: Error & { code?: string }) => {
        const message = reason instanceof FetchPackageError
          ? formatFetchPackageError(intl, reason)
          : reason.message;
        errorRef.current = message;
        statusRef.current = 'error';
        setError(message);
        setStatus('error');
      });
  }, [roomId, hostPeerId, transportConfig, initialCredential, locale, intl, agentName]);

  // 订阅 state / 事件，更新 refs 与渲染镜像
  useEffect(() => {
    if (!port) return;
    const offReady = port.onReady(() => {
      stateRef.current = port.getState();
      setStateJson(safeStringify(stateRef.current));
    });
    const offState = port.onState((next) => {
      stateRef.current = next;
      versionRef.current += 1;
      if (window.__partiAgent) window.__partiAgent.stateVersion = versionRef.current;
      setStateVersion(versionRef.current);
      setStateJson(safeStringify(next));
    });
    const offEvent = port.onEvent((event, payload) => {
      eventsRef.current.push({ event, payload, ts: Date.now() });
      setEventCount((count) => count + 1);
    });
    return () => {
      offReady();
      offState();
      offEvent();
    };
  }, [port]);

  const handleAgentGuide = useCallback((guide: unknown): void => {
    guideRef.current = guide;
    setGuideJson(safeStringify(guide));
  }, []);

  function leave(): void {
    if (roomId) clearRoomSession(roomId);
    portRef.current?.leave();
    location.replace(`${location.pathname}${location.search}#/`);
  }

  return (
    <div className="min-h-[100dvh] bg-[#0f0f10] p-4 text-[#e7e7ea]" data-connection-status={status}>
      <div className="mx-auto flex w-[min(1100px,100%)] flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/40 px-4 py-3">
          <div className="text-sm font-semibold">Parti · AI Agent</div>
          <div className="flex items-center gap-3 text-xs">
            <span id="parti-agent-status" data-status={status}>
              status: <b>{status}</b>
            </span>
            <span id="parti-agent-room">room: {roomId ?? '-'}</span>
            <button
              type="button"
              className="rounded border border-white/20 px-2 py-1 hover:bg-white/10"
              onClick={leave}
            >
              leave
            </button>
          </div>
        </header>

        {error && (
          <div id="parti-agent-error" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <p className="text-xs text-white/50">
          {intl.formatMessage({ id: 'agent.page.hint' })}
        </p>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="flex min-h-[320px] flex-col overflow-hidden rounded-lg border border-white/10 bg-black/30">
            <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-white/70">game view (for screenshots)</div>
            {pkg && port ? (
              <RoomFrame
                pkg={pkg}
                port={port}
                label="agent"
                role="agent"
                agent
                onAgentGuide={handleAgentGuide}
                className="min-h-[300px] flex-1 rounded-none border-0"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-white/40">connecting…</div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="rounded-lg border border-white/10 bg-black/30">
              <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-white/70">
                describe() — game guide {guideJson === 'null' && '(not provided by this room)'}
              </div>
              <pre id="parti-agent-guide" className="max-h-[240px] overflow-auto px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap">{guideJson}</pre>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30">
              <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-white/70">
                getState() — v{stateVersion} · events buffered: {eventsRef.current.length} (drained on read) · total seen: {eventCount}
              </div>
              <pre id="parti-agent-state" data-state-version={stateVersion} className="max-h-[320px] overflow-auto px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap">{stateJson}</pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
