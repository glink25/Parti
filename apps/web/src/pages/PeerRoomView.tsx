import { useEffect, useRef, useState } from 'react';
import { Settings2Icon } from 'lucide-react';
import type { HostRuntime, RoomAdmissionStatus } from '@parti/core';
import type { RoomClientPort } from '@parti/client-sdk';
import { createHostLocalPort } from '@parti/client-sdk';
import { type RoomPackage } from '@parti/room-packager';
import { InviteQrDialog } from '../components/InviteQrDialog.js';
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
import { loadLocalUser } from '../lib/localUser.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { copyTextToClipboard } from '@/lib/clipboard.js';
import { usePageFullscreen } from '@/components/PageFullscreen.js';
import { ResponsiveRoomControls, RoomControlsSheet, type RoomControlsProps } from '@/components/PeerRoomControls.js';

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
  if (!roomId || !pkg) return <div className="p-[22px] text-center text-[13px] text-muted-foreground">正在加载房间…</div>;
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
  const [qrOpen, setQrOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const { fullscreen, setFullscreen } = usePageFullscreen();
  const localUser = loadLocalUser();
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

  function updatePasswordDraft(value: string): void {
    setPasswordDraft(value);
    if (value === '' || value.length === 4) applySettings({ ...settings, password: value });
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
  if (!state || !admission) return <div className="p-[22px] text-center text-[13px] text-muted-foreground">正在准备房间…</div>;
  const activeAdmission = admission;

  const inviteUrl = buildInviteUrl(
    location.origin,
    location.pathname,
    roomId,
    state.hostPeerId,
    settings.password,
  );
  const roomTitle = settings.title.trim() || pkg.manifest.name;

  async function copyInvite(): Promise<void> {
    const ok = await copyTextToClipboard(inviteUrl);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const controlsProps: RoomControlsProps = {
    settings, passwordDraft, admission: activeAdmission, lobbyStatus, inviteUrl, copied,
    onCopyInvite: () => void copyInvite(),
    onOpenQr: () => setQrOpen(true),
    onPasswordDraftChange: updatePasswordDraft,
    onApplySettings: applySettings,
    onTogglePublic: () => void togglePublic(),
  };

  return (
    <div className={fullscreen ? 'h-[100dvh] w-[100dvw] overflow-hidden bg-black' : 'mx-auto w-[min(1240px,100%)]'}>
      {!fullscreen && <div className="mb-6 flex items-end justify-between gap-6 max-md:flex-col max-md:items-start max-md:gap-3.5">
        <div>
          <a className="mb-6 block w-max text-[13px] text-muted-foreground transition-colors hover:text-foreground" href="#/">← 退出房间</a>
          <span className="mb-2.5 block text-[11px] font-extrabold tracking-[0.16em] text-primary-bright">YOUR ROOM</span>
          <h1 className="text-[clamp(34px,5vw,54px)] font-extrabold tracking-[-0.05em]">{settings.title.trim() || pkg.manifest.name}</h1>
        </div>
        <div className="flex items-center gap-2.5 max-md:w-full max-md:justify-between">
          <div className="flex items-center gap-[7px] rounded-full border border-border bg-surface px-3.5 py-2 text-xs text-muted-foreground max-md:self-start">
            <span className="size-2 rounded-full bg-success shadow-[0_0_0_5px_rgba(81,219,147,0.11)]" />
            <b className="text-foreground">{admission.activePlayers}</b> 人在线
            {admission.maxPlayers !== null && <span> / {admission.maxPlayers}</span>}
          </div>
          <Button type="button" variant="outline" className="hidden min-h-11 max-md:inline-flex" onClick={() => setControlsOpen(true)}><Settings2Icon data-icon="inline-start" />房间设置</Button>
        </div>
      </div>}

      <div className={fullscreen ? 'h-full w-full' : 'grid grid-cols-[minmax(0,1fr)_330px] items-start gap-[18px] max-lg:grid-cols-1'}>
        <div>
          <div className="grid grid-cols-1">
            <RoomFrame html={state.roomHtml} port={state.port} label="房主画面" role="房主" fullscreen={fullscreen} onEnterFullscreen={() => { setControlsOpen(false); setFullscreen(true); }} onExitFullscreen={() => { setControlsOpen(false); setFullscreen(false); }} onFullscreenMore={() => setControlsOpen(true)} className={fullscreen ? undefined : 'min-h-[min(68vh,720px)] max-lg:min-h-[58vh] max-md:min-h-[62dvh]'} />
          </div>
        </div>
        {!fullscreen && <ResponsiveRoomControls open={controlsOpen} onOpenChange={setControlsOpen} props={controlsProps} />}
      </div>
      {!fullscreen && import.meta.env.DEV && <DevTools host={state.host} packageHash={pkg.packageHash} transportName="peerjs" />}
      {!fullscreen && <InviteQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        inviteUrl={inviteUrl}
        inviterName={localUser.name}
        roomTitle={roomTitle}
      />}
      {fullscreen && <RoomControlsSheet open={controlsOpen} onOpenChange={setControlsOpen} props={controlsProps} />}
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
    const user = loadLocalUser();
    fetchPackageOverPeer(roomId, hostPeerId, {
      clientId: user.id,
      ...(credential ? { credential } : {}),
    })
      .then((pkg) => {
        const joined = createPeerJoin(
          pkg,
          hostPeerId,
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

  const playerGate = 'flex min-h-[100dvh] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,211,55,0.25),transparent_34rem)] p-6';
  const gateMark = 'mb-2.5 grid size-12 place-items-center rounded-[15px] bg-primary text-[20px] font-black text-primary-foreground shadow-[0_8px_24px_rgba(201,151,0,0.2)]';

  if (needsPassword) {
    return (
      <div className={playerGate}>
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
        <Card className="flex w-full flex-col gap-3.5 rounded-[20px] border-border bg-surface p-[26px] shadow-soft">
          <span className={gateMark}>P</span>
          <h2 className="text-xl font-semibold">输入房间密码</h2>
          <p className="my-1 text-[11px] text-muted-foreground">这个房间需要密码才能加入。</p>
          {error && <p className="text-danger">{error}</p>}
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
  if (!state) return <div className={playerGate}><span className={gateMark}>P</span><div className="p-[22px] text-center text-[13px] text-muted-foreground">正在加入房间…</div></div>;

  return (
    <div className="h-[100dvh] w-[100dvw] overflow-hidden bg-black" data-connection-status={status}>
      <RoomFrame html={state.roomHtml} port={state.port} label="房间画面" role="玩家" fullscreen />
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
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,211,55,0.25),transparent_34rem)] p-6">
      <Card className="w-[min(440px,100%)] gap-3 p-[26px] text-center">
        <h2 className="text-xl font-semibold">暂时无法进入房间</h2>
        <p className="leading-[1.6] text-muted-foreground">{friendlyMessage}</p>
        <Button asChild variant="outline"><a href="#/">返回大厅</a></Button>
      </Card>
    </div>
  );
}
