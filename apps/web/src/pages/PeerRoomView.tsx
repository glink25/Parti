import { useEffect, useRef, useState } from 'react';
import { CopyIcon, Settings2Icon, WandSparklesIcon } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet.js';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    resolvePackage(roomId).then(setPkg).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [roomId]);

  if (error) return <RoomError message={error} />;
  if (!roomId || !pkg) return <div className="loading">正在加载房间…</div>;
  const initialSettings = loadHostRoomSettings(roomId) ?? {
    title: pkg.manifest.name,
    password: '',
    isPublic: false,
  };
  return <PeerHostSession pkg={pkg} initialSettings={initialSettings} />;
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
  const [copied, setCopied] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publisherRef = useRef<LobbyPublisher | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    saveHostRoomSettings(roomId, initialSettings);
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
          setLobbyStatus('大厅暂时不可用，房间已保持私密');
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
      setLobbyStatus('大厅暂时不可用，房间仍为私密');
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
  if (!state || !admission) return <div className="loading">正在准备房间…</div>;
  const activeAdmission = admission;

  const inviteUrl = buildInviteUrl(
    location.origin,
    location.pathname,
    roomId,
    state.hostPeerId,
    settings.password,
  );

  function copyInvite(): void {
    void navigator.clipboard?.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function inviteCard(): React.ReactNode {
    return (
      <Card className="invite-card gap-3">
        <CardHeader>
          <span className="control-label">邀请朋友</span>
          <CardTitle className="text-lg">一起加入房间</CardTitle>
          <CardDescription>{settings.password ? '链接中已包含房间密码，可以直接分享。' : '复制链接，邀请朋友现在加入。'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="invite">
            <Input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" onClick={copyInvite}><CopyIcon data-icon="inline-start" />{copied ? '已复制' : '复制'}</Button>
          </div>
          <div className="join-status"><span className={activeAdmission.joinable ? 'available' : 'full'} />{activeAdmission.joinable ? '当前可加入' : '房间人数已满'}</div>
        </CardContent>
      </Card>
    );
  }

  function settingsCard(): React.ReactNode {
    return (
      <Card className="room-settings compact gap-4">
        <CardHeader className="control-card-title">
          <div><span className="control-label">房间设置</span><CardTitle className="mt-1 text-lg">管理房间</CardTitle></div>
          <Badge variant={settings.isPublic ? 'default' : 'secondary'}>{settings.isPublic ? '公开' : '私密'}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
        <Label className="flex flex-col items-stretch gap-2 text-muted-foreground">
          房间标题
          <Input value={settings.title} maxLength={80} onChange={(event) => applySettings({ ...settings, title: event.target.value })} />
        </Label>
        <Label className="flex flex-col items-stretch gap-2 text-muted-foreground">
          4 位密码（留空为无密码）
          <div className="inline-field">
            <Input
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
            <Button type="button" variant="outline" onClick={() => {
              const value = generateRoomPassword();
              setPasswordDraft(value);
              applySettings({ ...settings, password: value });
            }}>
              <WandSparklesIcon data-icon="inline-start" />生成
            </Button>
          </div>
        </Label>
        <div className="room-actions">
          <Button type="button" variant={settings.isPublic ? 'outline' : 'default'} onClick={() => void togglePublic()}>
            {settings.isPublic ? '设为私密' : '公开到大厅'}
          </Button>
        </div>
        <span className="setting-status">{lobbyStatus}</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="page-shell host-page">
      <div className="room-page-heading">
        <div>
          <a className="back-link" href="#/">← 退出房间</a>
          <span className="eyebrow">YOUR ROOM</span>
          <h1>{settings.title.trim() || pkg.manifest.name}</h1>
        </div>
        <div className="room-heading-actions">
          <div className="room-presence">
            <span className="live-dot" />
            <b>{admission.activePlayers}</b> 人在线
            {admission.maxPlayers !== null && <span> / {admission.maxPlayers}</span>}
          </div>
          <Sheet open={controlsOpen} onOpenChange={setControlsOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" className="room-controls-button">
                <Settings2Icon data-icon="inline-start" />房间设置
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[88dvh] rounded-t-3xl border-border bg-popover px-0 pb-[env(safe-area-inset-bottom)]">
              <SheetHeader className="border-b px-5 py-4 text-left">
                <SheetTitle>房间设置</SheetTitle>
                <SheetDescription>邀请朋友加入，或调整标题、密码和公开状态。</SheetDescription>
              </SheetHeader>
              <div className="grid gap-3 overflow-y-auto px-4 pb-5 sm:grid-cols-2">
                {inviteCard()}
                {settingsCard()}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <div className="host-layout">
        <div className="game-column">
          <div className="room-stage single-room">
            <RoomFrame html={state.roomHtml} port={state.port} label="房主画面" role="房主" expandable />
          </div>
        </div>
        <aside className="host-sidebar">
          {inviteCard()}
          {settingsCard()}
        </aside>
      </div>
      {import.meta.env.DEV && <DevTools host={state.host} packageHash={pkg.packageHash} transportName="peerjs" />}
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
      <div className="player-gate">
        <form
          className="w-full max-w-[380px]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!/^\d{4}$/.test(passwordInput)) return;
            setState(null);
            setCredential(passwordInput);
            setAttempt((value) => value + 1);
          }}
        >
        <Card className="password-form">
          <span className="player-gate-mark">P</span>
          <h2>输入房间密码</h2>
          <p className="meta-line">这个房间需要密码才能加入。</p>
          {error && <p className="error">{error}</p>}
          <Input
            autoFocus
            aria-label="4 位房间密码"
            value={passwordInput}
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            placeholder="4 位数字密码"
            onChange={(event) => setPasswordInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <Button type="submit">加入房间</Button>
        </Card>
        </form>
      </div>
    );
  }
  if (error) return <RoomError message={error} />;
  if (!state) return <div className="player-gate"><span className="player-gate-mark">P</span><div className="loading">正在加入房间…</div></div>;

  return (
    <div className="player-session" data-connection-status={status}>
      <RoomFrame html={state.roomHtml} port={state.port} label="房间画面" role="玩家" immersive />
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
  const friendlyMessage = /peer|connect|network|socket/i.test(message)
    ? '暂时无法连接房主，请确认房间仍在进行并稍后重试。'
    : message;
  return <div className="player-gate"><Card className="error error-card"><h2>暂时无法进入房间</h2><p>{friendlyMessage}</p><Button asChild variant="outline"><a href="#/">返回大厅</a></Button></Card></div>;
}
