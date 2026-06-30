import { useEffect, useRef, useState } from 'react';
import type { HostRuntime, RoomAdmissionStatus } from '@parti/core';
import { SessionStorageStore } from '@parti/core';
import type { RoomClientPort } from '@parti/client-sdk';
import { createHostLocalPort } from '@parti/client-sdk';
import { type RoomPackage } from '@parti/room-packager';
import { RoomFrame } from '../components/RoomFrame.js';
import { DevTools } from '../components/DevTools.js';
import {
  createPeerHost,
  createPeerJoin,
  registerRoomDisposer,
} from '../lib/PeerRoomSession.js';
import { resolvePackage } from '../lib/rooms.js';
import { fetchPackageOverPeer } from '../lib/fetchPackageOverPeer.js';
import {
  createPasswordAdmissionController,
  generateRoomPassword,
  loadHostRoomSettings,
  saveHostRoomSettings,
  type HostRoomSettings,
} from '../lib/roomSettings.js';
import {
  LobbyClient,
  LobbyPublisher,
  lobbyServiceUrl,
  type LobbyRoomInput,
} from '../lib/lobbyApi.js';
import { buildInviteUrl, parsePeerRoute } from '../lib/peerRoutes.js';

export function PeerRoomView() {
  const route = parsePeerRoute(window.location.hash);
  if (route.mode === 'join') {
    return (
      <PeerJoinView
        roomId={route.roomId}
        hostPeerId={route.hostPeerId}
        initialCredential={route.credential}
      />
    );
  }
  return <PeerHostView roomId={route.roomId} />;
}

function PeerHostView({ roomId }: { roomId?: string }) {
  const [pkg, setPkg] = useState<RoomPackage | null>(null);
  const [settings, setSettings] = useState<HostRoomSettings | null>(() =>
    roomId ? loadHostRoomSettings(roomId) : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    resolvePackage(roomId).then(setPkg).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [roomId]);

  if (error) return <RoomError message={error} />;
  if (!roomId || !pkg) return <div className="loading">正在加载房间…</div>;
  if (!settings) {
    return (
      <HostSetupForm
        defaultTitle={pkg.manifest.name}
        onSubmit={(next) => {
          saveHostRoomSettings(roomId, next);
          setSettings(next);
        }}
      />
    );
  }
  return <PeerHostSession pkg={pkg} initialSettings={settings} />;
}

function HostSetupForm({
  defaultTitle,
  onSubmit,
}: {
  defaultTitle: string;
  onSubmit: (settings: HostRoomSettings) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [protectedRoom, setProtectedRoom] = useState(false);
  const [password, setPassword] = useState('');

  return (
    <form
      className="card room-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        if (protectedRoom && !/^\d{4}$/.test(password)) return;
        onSubmit({ title: title.trim(), password: protectedRoom ? password : '', isPublic: false });
      }}
    >
      <h2>创建联机房间</h2>
      <label>
        房间标题
        <input value={title} maxLength={80} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={protectedRoom}
          onChange={(event) => setProtectedRoom(event.target.checked)}
        />
        需要 4 位数字密码
      </label>
      {protectedRoom && (
        <div className="inline-field">
          <input
            value={password}
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            placeholder="0000"
            required
            onChange={(event) => setPassword(event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <button type="button" className="secondary" onClick={() => setPassword(generateRoomPassword())}>
            自动生成
          </button>
        </div>
      )}
      <p className="meta-line">房间创建后默认为私密，可在房主面板中公开到大厅。</p>
      <button type="submit">创建房间</button>
    </form>
  );
}

function PeerHostSession({
  pkg,
  initialSettings,
}: {
  pkg: RoomPackage;
  initialSettings: HostRoomSettings;
}) {
  const roomId = pkg.manifest.id;
  const [state, setState] = useState<{
    host: HostRuntime;
    roomHtml: string;
    hostPeerId: string;
    port: RoomClientPort;
  } | null>(null);
  const [settings, setSettings] = useState(initialSettings);
  const [passwordDraft, setPasswordDraft] = useState(initialSettings.password);
  const settingsRef = useRef(settings);
  const [admission, setAdmission] = useState<RoomAdmissionStatus | null>(null);
  const [lobbyStatus, setLobbyStatus] = useState(initialSettings.isPublic ? '正在恢复公开状态…' : '私密');
  const [error, setError] = useState<string | null>(null);
  const publisherRef = useRef<LobbyPublisher | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createPeerHost(pkg, {
      admissionController: createPasswordAdmissionController(initialSettings.password),
    })
      .then((peerHost) => {
        setState({
          host: peerHost.host,
          roomHtml: peerHost.roomHtml,
          hostPeerId: peerHost.hostPeerId,
          port: createHostLocalPort(peerHost.host),
        });
        setAdmission(peerHost.host.getAdmissionStatus());
        const baseUrl = lobbyServiceUrl();
        if (baseUrl) {
          const publisher = new LobbyPublisher(roomId, new LobbyClient(baseUrl), setLobbyStatus);
          publisherRef.current = publisher;
          registerRoomDisposer(roomId, () => void publisher.unpublish());
          if (initialSettings.isPublic) {
            void publisher.publish(
              lobbyInput(pkg, peerHost.hostPeerId, initialSettings, peerHost.host.getAdmissionStatus()),
            ).catch((reason) => {
              setLobbyStatus(reason instanceof Error ? reason.message : String(reason));
            });
          }
        } else if (initialSettings.isPublic) {
          const privateSettings = { ...initialSettings, isPublic: false };
          settingsRef.current = privateSettings;
          setSettings(privateSettings);
          saveHostRoomSettings(roomId, privateSettings);
          setLobbyStatus('未配置大厅服务，已保持私密');
        }
        peerHost.host.admissionStatusChanged.on((status) => {
          setAdmission(status);
          const current = settingsRef.current;
          if (current.isPublic && publisherRef.current) {
            void publisherRef.current.sync(lobbyInput(pkg, peerHost.hostPeerId, current, status));
          }
        });
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [initialSettings, pkg, roomId]);

  function applySettings(next: HostRoomSettings): void {
    if (!state || (next.password && !/^\d{4}$/.test(next.password))) return;
    settingsRef.current = next;
    setSettings(next);
    saveHostRoomSettings(roomId, next);
    state.host.setAdmissionController(createPasswordAdmissionController(next.password));
    if (next.isPublic && admission && publisherRef.current) {
      void publisherRef.current.sync(lobbyInput(pkg, state.hostPeerId, next, admission));
    }
  }

  async function togglePublic(): Promise<void> {
    if (!state || !admission) return;
    if (settings.isPublic) {
      await publisherRef.current?.unpublish();
      applySettings({ ...settings, isPublic: false });
      return;
    }
    const baseUrl = lobbyServiceUrl();
    if (!baseUrl) {
      setLobbyStatus('未配置 VITE_LOBBY_SERVICE_URL，房间仍为私密');
      return;
    }
    const publisher = publisherRef.current ?? new LobbyPublisher(roomId, new LobbyClient(baseUrl), setLobbyStatus);
    publisherRef.current = publisher;
    try {
      await publisher.publish(lobbyInput(pkg, state.hostPeerId, settings, admission));
      applySettings({ ...settings, isPublic: true });
    } catch (reason) {
      await publisher.unpublish();
      setLobbyStatus(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (error) return <RoomError message={error} />;
  if (!state || !admission) return <div className="loading">正在创建 PeerJS 房间…</div>;

  const inviteUrl = buildInviteUrl(
    location.origin,
    location.pathname,
    roomId,
    state.hostPeerId,
    settings.password,
  );
  return (
    <div>
      <h2>{settings.title.trim() || pkg.manifest.name}</h2>
      <div className="host-grid">
        <div className="card">
          <p className="meta-line">邀请链接{settings.password ? '已包含房间密码' : ''}：</p>
          <div className="invite">
            <input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
            <button onClick={() => navigator.clipboard?.writeText(inviteUrl)}>复制</button>
          </div>
          <p className="meta-line">
            在线 {admission.activePlayers} · 占位 {admission.reservedPlayers}
            {admission.maxPlayers === null ? ' · 不限人数' : ` / ${admission.maxPlayers}`}
            {' · '}{admission.joinable ? '允许加入' : '房间已满'}
          </p>
        </div>
        <div className="card room-settings compact">
          <label>
            房间标题
            <input value={settings.title} maxLength={80} onChange={(event) => applySettings({ ...settings, title: event.target.value })} />
          </label>
          <label>
            4 位密码（留空为无密码）
            <div className="inline-field">
              <input
                value={passwordDraft}
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, '').slice(0, 4);
                  setPasswordDraft(value);
                  if (value === '' || value.length === 4) {
                    applySettings({ ...settings, password: value });
                  }
                }}
                onBlur={() => {
                  if (passwordDraft !== '' && !/^\d{4}$/.test(passwordDraft)) {
                    setPasswordDraft(settings.password);
                  }
                }}
              />
              <button type="button" className="secondary" onClick={() => {
                const value = generateRoomPassword();
                setPasswordDraft(value);
                applySettings({ ...settings, password: value });
              }}>
                生成
              </button>
            </div>
          </label>
          <div className="room-actions">
            <button className={settings.isPublic ? 'secondary' : ''} onClick={() => void togglePublic()}>
              {settings.isPublic ? '设为私密' : '公开到大厅'}
            </button>
            <span className="meta-line">{lobbyStatus}</span>
          </div>
        </div>
      </div>
      <div className="room-stage single-room">
        <RoomFrame html={state.roomHtml} port={state.port} label="Host (你)" role="host" />
      </div>
      <DevTools host={state.host} packageHash={pkg.packageHash} transportName="peerjs" />
    </div>
  );
}

function PeerJoinView({
  roomId,
  hostPeerId,
  initialCredential,
}: {
  roomId?: string;
  hostPeerId?: string;
  initialCredential?: string;
}) {
  const [credential, setCredential] = useState(initialCredential ?? '');
  const [passwordInput, setPasswordInput] = useState(initialCredential ?? '');
  const [attempt, setAttempt] = useState(0);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [state, setState] = useState<{ roomHtml: string; port: RoomClientPort } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('connecting');
  const activeAttempt = useRef('');

  useEffect(() => {
    if (!initialCredential) return;
    const cleanHash = window.location.hash.split('?')[0];
    history.replaceState(null, '', `${location.pathname}${location.search}${cleanHash}`);
  }, [initialCredential]);

  useEffect(() => {
    if (!roomId || !hostPeerId) return;
    const key = `${roomId}:${hostPeerId}:${credential}:${attempt}`;
    if (activeAttempt.current === key) return;
    activeAttempt.current = key;
    setError(null);
    setNeedsPassword(false);
    const store = new SessionStorageStore();
    const clientId = store.loadClientId(roomId) ?? undefined;
    fetchPackageOverPeer(roomId, hostPeerId, {
      ...(clientId ? { clientId } : {}),
      ...(credential ? { credential } : {}),
    })
      .then((pkg) => {
        const joined = createPeerJoin(
          pkg,
          hostPeerId,
          'Guest',
          {
            onStatus: setStatus,
            onFatal: (message) => {
              if (message.startsWith('CREDENTIAL_') || message.startsWith('INVALID_CREDENTIAL')) {
                setNeedsPassword(true);
              } else {
                setError(message);
              }
            },
          },
          credential || undefined,
        );
        setState({ roomHtml: joined.roomHtml, port: joined.port });
      })
      .catch((reason: Error & { code?: string }) => {
        if (reason.code === 'CREDENTIAL_REQUIRED' || reason.code === 'INVALID_CREDENTIAL') {
          setNeedsPassword(true);
          setError(reason.code === 'INVALID_CREDENTIAL' ? '密码错误，请重试' : null);
        } else {
          setError(reason.message);
        }
      });
  }, [attempt, credential, hostPeerId, roomId]);

  if (needsPassword) {
    return (
      <form
        className="card password-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d{4}$/.test(passwordInput)) return;
          setState(null);
          setCredential(passwordInput);
          setAttempt((value) => value + 1);
        }}
      >
        <h2>输入房间密码</h2>
        {error && <p className="error">{error}</p>}
        <input
          autoFocus
          value={passwordInput}
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="4 位数字密码"
          onChange={(event) => setPasswordInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <button type="submit">加入房间</button>
      </form>
    );
  }
  if (error) return <RoomError message={error} />;
  if (!state) return <div className="loading">正在连接房主（{status}）…</div>;

  return (
    <div>
      <h2>PeerJS 房间（玩家）</h2>
      <p className="meta-line">连接状态：{status}</p>
      <div className="room-stage single-room">
        <RoomFrame html={state.roomHtml} port={state.port} label="你" role="player" />
      </div>
    </div>
  );
}

function lobbyInput(
  pkg: RoomPackage,
  hostPeerId: string,
  settings: HostRoomSettings,
  admission: RoomAdmissionStatus,
): LobbyRoomInput {
  return {
    roomId: pkg.manifest.id,
    hostPeerId,
    title: settings.title.trim() || pkg.manifest.name,
    packageName: pkg.manifest.name,
    playerCount: admission.activePlayers,
    maxPlayers: admission.maxPlayers,
    joinable: admission.joinable,
    credentialRequired: Boolean(settings.password),
  };
}

function RoomError({ message }: { message: string }) {
  return <div className="card error">出错：{message} · <a href="#/">返回</a></div>;
}
