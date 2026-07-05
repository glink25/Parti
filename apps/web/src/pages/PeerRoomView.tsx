import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Settings2Icon } from 'lucide-react';
import type { HostRuntime, RoomAdmissionStatus } from '@parti/core';
import type { RoomClientPort } from '@parti/client-sdk';
import { createHostLocalPort } from '@parti/client-sdk';
import { type RoomPackage } from '@parti/room-packager';
import { InviteQrDialog } from '../components/InviteQrDialog';
import { RoomFrame, type SensorPermissionControl } from '../components/RoomFrame';
import { DevTools } from '../components/DevTools';
import {
  createPeerHost,
  createPeerJoin,
  clearRoomSession,
  registerRoomDisposer,
} from '../lib/PeerRoomSession';
import { loadRoomSnapshot } from '../lib/customRooms';
import { FetchPackageError, fetchPackageOverPeer } from '../lib/fetchPackageOverPeer';
import {
  createPasswordAdmissionController,
  loadHostRoomSettings,
  saveHostRoomSettings,
  type HostRoomSettings,
} from '../lib/roomSettings';
import {
  LobbyClient,
  LobbyPublisher,
  lobbyServiceUrl,
  type LobbyRoomInput,
  type LobbyStatusKey,
} from '../lib/lobbyApi';
import { buildInviteUrl, parsePeerRoute } from '../lib/peerRoutes';
import { loadLocalUser } from '../lib/localUser';
import { useLocale } from '@/i18n/LocaleProvider';
import { formatFetchPackageError, formatResolveError, formatRoomError } from '@/i18n/formatErrors';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { copyTextToClipboard } from '@/lib/clipboard';
import { usePageFullscreen } from '@/components/PageFullscreen';
import { ResponsiveRoomControls, RoomControlsSheet, type RoomControlsProps } from '@/components/PeerRoomControls';
import { Logo } from '@/components/Logo';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ReplayRecordingController } from '../replays/recorder';
import { ENABLE_REPLAYS } from '../lib/featureFlags';
import { configuredTransport, type TransportConfig } from '../lib/transportConfig';

export function PeerRoomView() {
  const route = parsePeerRoute(window.location.hash);
  if (route.mode === 'join') {
    return (
      <PeerJoinView
        roomId={route.roomId}
        hostPeerId={route.hostPeerId}
        transportConfig={route.transportConfig}
        initialCredential={route.credential}
      />
    );
  }
  try { return <PeerHostView roomId={route.roomId} transportConfig={configuredTransport()} />; }
  catch (reason) { return <RoomError message={reason instanceof Error ? reason.message : String(reason)} />; }
}

function PeerHostView({ roomId, transportConfig }: { roomId?: string; transportConfig: TransportConfig }) {
  const intl = useIntl();
  const [pkg, setPkg] = useState<RoomPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    loadRoomSnapshot(roomId).then(setPkg).catch((reason) => {
      setError(formatResolveError(intl, reason));
    });
  }, [intl, roomId]);

  if (error) return <RoomError message={error} />;
  if (!roomId || !pkg) {
    return <div className="p-[22px] text-center text-[13px] text-muted-foreground"><FormattedMessage id="peer.loading.room" /></div>;
  }
  const storedSettings = loadHostRoomSettings(roomId);
  const initialSettings = storedSettings ? {
    ...storedSettings,
    replayEnabled: ENABLE_REPLAYS && storedSettings.replayEnabled,
  } : {
    title: pkg.manifest.name,
    password: '',
    isPublic: false,
    replayEnabled: false,
  };
  return <PeerHostSession pkg={pkg} initialSettings={initialSettings} transportConfig={transportConfig} />;
}

function PeerHostSession({
  pkg,
  initialSettings,
  transportConfig,
}: {
  pkg: RoomPackage;
  initialSettings: HostRoomSettings;
  transportConfig: TransportConfig;
}) {
  const intl = useIntl();
  const { locale } = useLocale();
  const roomId = pkg.manifest.id;
  const [state, setState] = useState<{
    host: HostRuntime;
    roomHtml: string;
    hostPeerId: string;
    port: RoomClientPort;
    basePort: RoomClientPort;
    portVersion: number;
  } | null>(null);
  const [settings, setSettings] = useState(initialSettings);
  const [passwordDraft, setPasswordDraft] = useState(initialSettings.password);
  const settingsRef = useRef(settings);
  const [admission, setAdmission] = useState<RoomAdmissionStatus | null>(null);
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatusKey>(
    initialSettings.isPublic ? 'restoring' : 'private',
  );
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const { fullscreen, setFullscreen } = usePageFullscreen();
  const localUser = loadLocalUser(undefined, locale);
  const [error, setError] = useState<string | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [sensorPermission, setSensorPermission] = useState<SensorPermissionControl | null>(null);
  const onSensorPermissionChange = useCallback((control: SensorPermissionControl | null) => {
    setSensorPermission(control);
  }, []);
  const recordingRef = useRef<ReplayRecordingController | null>(null);
  const publisherRef = useRef<LobbyPublisher | null>(null);
  const started = useRef(false);
  const lastLobbySyncAtRef = useRef(0);
  const lobbySyncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPublicToggleAtRef = useRef(0);
  const [publicToggleBusy, setPublicToggleBusy] = useState(false);

  const LOBBY_SYNC_INTERVAL_MS = 2000;
  const PUBLIC_TOGGLE_COOLDOWN_MS = 2000;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    saveHostRoomSettings(roomId, initialSettings);
    createPeerHost(pkg, {
      transportConfig,
      admissionController: createPasswordAdmissionController(initialSettings.password),
    })
      .then((peerHost) => {
        const basePort = createHostLocalPort(peerHost.host);
        setState({
          host: peerHost.host,
          roomHtml: peerHost.roomHtml,
          hostPeerId: peerHost.hostPeerId,
          port: basePort,
          basePort,
          portVersion: 0,
        });
        setAdmission(peerHost.host.getAdmissionStatus());
        const baseUrl = lobbyServiceUrl();
        if (baseUrl) {
          const publisher = new LobbyPublisher(roomId, new LobbyClient(baseUrl), (status) => {
            setLobbyStatus(status);
            setLobbyError(null);
          });
          publisherRef.current = publisher;
          registerRoomDisposer(roomId, () => void publisher.unpublish());
          if (initialSettings.isPublic) {
            void publisher.publish(
              lobbyInput(pkg, peerHost.hostPeerId, transportConfig, initialSettings, peerHost.host.getAdmissionStatus()),
            ).catch((reason) => {
              setLobbyError(reason instanceof Error ? reason.message : String(reason));
            });
          }
        } else if (initialSettings.isPublic) {
          const privateSettings = { ...initialSettings, isPublic: false };
          settingsRef.current = privateSettings;
          setSettings(privateSettings);
          saveHostRoomSettings(roomId, privateSettings);
          setLobbyStatus('lobbyUnavailableKeptPrivate');
        }
        peerHost.host.admissionStatusChanged.on((status) => {
          setAdmission(status);
          const current = settingsRef.current;
          if (current.isPublic && publisherRef.current) {
            void publisherRef.current.sync(lobbyInput(pkg, peerHost.hostPeerId, transportConfig, current, status));
          }
        });
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [initialSettings, pkg, roomId]);

  useEffect(() => {
    if (!ENABLE_REPLAYS || !state || !settings.replayEnabled || recordingRef.current) return;
    let cancelled = false;
    setReplayBusy(true);
    setReplayError(null);
    import('../replays/recorder')
      .then(({ startReplayRecording }) => startReplayRecording({
        host: state.host,
        port: state.basePort,
        pkg,
        title: settings.title.trim() || pkg.manifest.name,
        onError: (reason) => {
          setReplayError(reason.message);
          setSettings((current) => {
            const next = { ...current, replayEnabled: false };
            saveHostRoomSettings(roomId, next);
            return next;
          });
        },
      }))
      .then((controller) => {
        if (cancelled) {
          void controller.stop();
          return;
        }
        recordingRef.current = controller;
        setState((current) => current ? { ...current, port: controller.port, portVersion: current.portVersion + 1 } : current);
      })
      .catch((reason) => {
        setReplayError(reason instanceof Error ? reason.message : String(reason));
        setSettings((current) => {
          const next = { ...current, replayEnabled: false };
          saveHostRoomSettings(roomId, next);
          return next;
        });
      })
      .finally(() => setReplayBusy(false));
    return () => { cancelled = true; };
  }, [pkg, settings.replayEnabled, state?.host]);

  useEffect(() => {
    if (settings.replayEnabled || !recordingRef.current) return;
    const controller = recordingRef.current;
    recordingRef.current = null;
    setState((current) => current ? { ...current, port: current.basePort, portVersion: current.portVersion + 1 } : current);
    setReplayBusy(true);
    void controller.stop()
      .catch((reason) => setReplayError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setReplayBusy(false));
  }, [settings.replayEnabled]);

  useEffect(() => {
    const finishWhenLeavingRoom = () => {
      const parts = window.location.hash.replace(/^#/, '').split('/').filter(Boolean);
      if (parts[0] === 'peer' && parts[2] === roomId) return;
      const controller = recordingRef.current;
      recordingRef.current = null;
      if (controller) void controller.stop();
    };
    window.addEventListener('hashchange', finishWhenLeavingRoom);
    return () => window.removeEventListener('hashchange', finishWhenLeavingRoom);
  }, [roomId]);

  useEffect(() => () => {
    if (lobbySyncTimerRef.current) clearTimeout(lobbySyncTimerRef.current);
  }, []);

  function runLobbySync(): void {
    if (!state || !publisherRef.current) return;
    const current = settingsRef.current;
    if (!current.isPublic) return;
    void publisherRef.current.sync(
      lobbyInput(pkg, state.hostPeerId, transportConfig, current, state.host.getAdmissionStatus()),
    );
    lastLobbySyncAtRef.current = Date.now();
  }

  function scheduleLobbySync(): void {
    if (!state || !publisherRef.current || !settingsRef.current.isPublic) return;
    const elapsed = Date.now() - lastLobbySyncAtRef.current;
    if (elapsed >= LOBBY_SYNC_INTERVAL_MS) {
      if (lobbySyncTimerRef.current) {
        clearTimeout(lobbySyncTimerRef.current);
        lobbySyncTimerRef.current = undefined;
      }
      runLobbySync();
      return;
    }
    if (lobbySyncTimerRef.current) clearTimeout(lobbySyncTimerRef.current);
    lobbySyncTimerRef.current = setTimeout(() => {
      lobbySyncTimerRef.current = undefined;
      runLobbySync();
    }, LOBBY_SYNC_INTERVAL_MS - elapsed);
  }

  function applySettings(next: HostRoomSettings, options?: { skipLobbySync?: boolean }): void {
    if (!state || (next.password && !/^\d{4}$/.test(next.password))) return;
    settingsRef.current = next;
    setSettings(next);
    saveHostRoomSettings(roomId, next);
    state.host.setAdmissionController(createPasswordAdmissionController(next.password));
    if (!options?.skipLobbySync && next.isPublic && publisherRef.current) {
      scheduleLobbySync();
    }
  }

  function updatePasswordDraft(value: string): void {
    setPasswordDraft(value);
    if (value === '' || value.length === 4) applySettings({ ...settings, password: value });
  }

  function toggleReplay(): void {
    if (!ENABLE_REPLAYS) return;
    const next = { ...settings, replayEnabled: !settings.replayEnabled };
    setReplayError(null);
    settingsRef.current = next;
    setSettings(next);
    saveHostRoomSettings(roomId, next);
  }

  async function togglePublic(): Promise<void> {
    if (!state || !admission || publicToggleBusy) return;
    if (Date.now() - lastPublicToggleAtRef.current < PUBLIC_TOGGLE_COOLDOWN_MS) return;
    setPublicToggleBusy(true);
    try {
      if (settings.isPublic) {
        await publisherRef.current?.unpublish();
        applySettings({ ...settings, isPublic: false }, { skipLobbySync: true });
        return;
      }
      const baseUrl = lobbyServiceUrl();
      if (!baseUrl) {
        setLobbyStatus('lobbyUnavailableStillPrivate');
        return;
      }
      const publisher = publisherRef.current ?? new LobbyPublisher(roomId, new LobbyClient(baseUrl), (status) => {
        setLobbyStatus(status);
        setLobbyError(null);
      });
      publisherRef.current = publisher;
      try {
        await publisher.publish(lobbyInput(pkg, state.hostPeerId, transportConfig, settings, admission));
        lastLobbySyncAtRef.current = Date.now();
        applySettings({ ...settings, isPublic: true }, { skipLobbySync: true });
      } catch (reason) {
        await publisher.unpublish();
        setLobbyError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      lastPublicToggleAtRef.current = Date.now();
      setPublicToggleBusy(false);
    }
  }

  if (error) return <RoomError message={error} />;
  if (!state || !admission) {
    return <div className="p-[22px] text-center text-[13px] text-muted-foreground"><FormattedMessage id="peer.loading.preparing" /></div>;
  }
  const activeAdmission = admission;

  const inviteUrl = buildInviteUrl(
    location.origin,
    location.pathname,
    roomId,
    state.hostPeerId,
    settings.password,
    transportConfig,
  );
  const roomTitle = settings.title.trim() || pkg.manifest.name;

  async function copyInvite(): Promise<void> {
    const ok = await copyTextToClipboard(inviteUrl);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const controlsProps: RoomControlsProps = {
    settings,
    passwordDraft,
    admission: activeAdmission,
    lobbyStatus,
    lobbyError,
    inviteUrl,
    copied,
    transportConfig,
    onCopyInvite: () => void copyInvite(),
    onOpenQr: () => setQrOpen(true),
    onPasswordDraftChange: updatePasswordDraft,
    onApplySettings: applySettings,
    onTogglePublic: () => void togglePublic(),
    publicToggleBusy,
    replayBusy,
    replayError,
    onToggleReplay: toggleReplay,
    sensorPermission,
  };

  return (
    <div className={fullscreen ? 'h-[100dvh] w-[100dvw] overflow-hidden bg-black' : 'mx-auto w-[min(1240px,100%)]'}>
      {!fullscreen && <div className="mb-6 flex items-end justify-between gap-6 max-md:flex-col max-md:items-start max-md:gap-3.5">
        <div>
          <a className="mb-6 block w-max text-[13px] text-muted-foreground transition-colors hover:text-foreground" href="#/">
            <FormattedMessage id="peer.host.exit" />
          </a>
          <span className="mb-2.5 block text-[11px] font-extrabold tracking-[0.16em] text-primary-bright">YOUR ROOM</span>
          <h1 className="text-[clamp(34px,5vw,54px)] font-extrabold tracking-[-0.05em]">{settings.title.trim() || pkg.manifest.name}</h1>
        </div>
        <div className="flex items-center gap-2.5 max-md:w-full max-md:justify-between">
          <div className="flex items-center gap-[7px] rounded-full border border-border bg-surface px-3.5 py-2 text-xs text-muted-foreground max-md:self-start">
            <span className="size-2 rounded-full bg-success shadow-[0_0_0_5px_rgba(81,219,147,0.11)]" />
            {intl.formatMessage(
              { id: 'peer.host.playersOnline' },
              {
                count: admission.activePlayers,
                b: (chunks) => <b className="text-foreground">{chunks}</b>,
              },
            )}
            {admission.maxPlayers !== null && (
              <span>{intl.formatMessage({ id: 'peer.host.playersCapacity' }, { max: admission.maxPlayers })}</span>
            )}
          </div>
          <Button type="button" variant="outline" className="hidden min-h-11 max-md:inline-flex" onClick={() => setControlsOpen(true)}>
            <Settings2Icon data-icon="inline-start" /><FormattedMessage id="peer.host.settings" />
          </Button>
        </div>
      </div>}

      <div className={fullscreen ? 'h-full w-full' : 'grid grid-cols-[minmax(0,1fr)_330px] items-start gap-[18px] max-lg:grid-cols-1'}>
        <div>
          <div className="grid grid-cols-1">
            <RoomFrame
              key={state.portVersion}
              pkg={pkg}
              port={state.port}
              label={intl.formatMessage({ id: 'peer.host.hostView' })}
              role={intl.formatMessage({ id: 'peer.role.host' })}
              fullscreen={fullscreen}
              onEnterFullscreen={() => { setControlsOpen(false); setFullscreen(true); }}
              onExitFullscreen={() => { setControlsOpen(false); setFullscreen(false); }}
              onFullscreenMore={() => setControlsOpen(true)}
              className={fullscreen ? undefined : 'min-h-[min(68vh,720px)] max-lg:min-h-[58vh] max-md:min-h-[62dvh]'}
              onSensorPermissionChange={pkg.manifest.permissions?.sensors?.length ? onSensorPermissionChange : undefined}
            />
          </div>
        </div>
        {!fullscreen && <ResponsiveRoomControls open={controlsOpen} onOpenChange={setControlsOpen} props={controlsProps} />}
      </div>
      {!fullscreen && import.meta.env.DEV && <DevTools host={state.host} packageHash={pkg.packageHash} transportName="peerjs" />}
      <InviteQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        inviteUrl={inviteUrl}
        inviterName={localUser.name}
        roomTitle={roomTitle}
      />
      {fullscreen && <RoomControlsSheet open={controlsOpen} onOpenChange={setControlsOpen} props={controlsProps} />}
    </div>
  );
}

function PeerJoinView({
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
  const [credential, setCredential] = useState(initialCredential ?? '');
  const [passwordInput, setPasswordInput] = useState(initialCredential ?? '');
  const [attempt, setAttempt] = useState(0);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [state, setState] = useState<{ pkg: RoomPackage; port: RoomClientPort; roomTitle: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('connecting');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sensorPermission, setSensorPermission] = useState<SensorPermissionControl | null>(null);
  const onSensorPermissionChange = useCallback((control: SensorPermissionControl | null) => {
    setSensorPermission(control);
  }, []);
  const activeAttempt = useRef('');
  const localUser = loadLocalUser(undefined, locale);

  useEffect(() => {
    if (!initialCredential) return;
    const [path, query = ''] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    params.delete('password');
    const cleanHash = `${path}${params.size ? `?${params.toString()}` : ''}`;
    history.replaceState(null, '', `${location.pathname}${location.search}${cleanHash}`);
  }, [initialCredential]);

  useEffect(() => {
    if (!roomId || !hostPeerId) return;
    const key = `${roomId}:${hostPeerId}:${credential}:${attempt}`;
    if (activeAttempt.current === key) return;
    activeAttempt.current = key;
    setError(null);
    setNeedsPassword(false);
    const user = loadLocalUser(undefined, locale);
    fetchPackageOverPeer(roomId, hostPeerId, {
      clientId: user.id,
      transportConfig,
      ...(credential ? { credential } : {}),
    })
      .then((pkg) => {
        const joined = createPeerJoin(
          pkg,
          hostPeerId,
          transportConfig,
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
        setState({ pkg, port: joined.port, roomTitle: pkg.manifest.name });
      })
      .catch((reason: Error & { code?: string }) => {
        if (reason instanceof FetchPackageError) {
          setError(formatFetchPackageError(intl, reason));
          return;
        }
        if (reason.code === 'CREDENTIAL_REQUIRED' || reason.code === 'INVALID_CREDENTIAL') {
          setNeedsPassword(true);
          setError(reason.code === 'INVALID_CREDENTIAL'
            ? intl.formatMessage({ id: 'peer.join.wrongPassword' })
            : null);
        } else {
          setError(reason.message);
        }
      });
  }, [attempt, credential, hostPeerId, intl, locale, roomId, transportConfig]);

  const playerGate = 'flex min-h-[100dvh] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,211,55,0.25),transparent_34rem)] p-6';

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
          <Logo size="md" className="mb-2.5" />
          <h2 className="text-xl font-semibold"><FormattedMessage id="peer.join.passwordTitle" /></h2>
          <p className="my-1 text-[11px] text-muted-foreground"><FormattedMessage id="peer.join.passwordDescription" /></p>
          {error && <p className="text-danger">{error}</p>}
          <Input
            autoFocus
            aria-label={intl.formatMessage({ id: 'peer.join.passwordAria' })}
            value={passwordInput}
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            placeholder={intl.formatMessage({ id: 'peer.join.passwordPlaceholder' })}
            onChange={(event) => setPasswordInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <Button type="submit"><FormattedMessage id="peer.join.join" /></Button>
        </Card>
        </form>
      </div>
    );
  }
  if (error) return <RoomError message={error} />;
  if (!state || !roomId || !hostPeerId) {
    return (
      <div className={playerGate}>
        <Logo size="md" className="mb-2.5" />
        <div className="p-[22px] text-center text-[13px] text-muted-foreground">
          <FormattedMessage id="peer.loading.joining" />
          <br />
          <span className="text-[11px]"><FormattedMessage id="peer.loading.browserHint" /></span>
        </div>
      </div>
    );
  }

  const inviteUrl = buildInviteUrl(
    location.origin,
    location.pathname,
    roomId,
    hostPeerId,
    credential,
    transportConfig,
  );

  async function copyInvite(): Promise<void> {
    const ok = await copyTextToClipboard(inviteUrl);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function leaveRoom(): void {
    if (!roomId) return;
    clearRoomSession(roomId);
    location.replace(`${location.pathname}${location.search}#/`);
  }

  const shareControlsProps: RoomControlsProps = {
    settings: { title: state.roomTitle, password: credential, isPublic: false, replayEnabled: false },
    passwordDraft: credential,
    admission: { activePlayers: 0, reservedPlayers: 0, maxPlayers: null, joinable: true },
    lobbyStatus: 'private',
    lobbyError: null,
    inviteUrl,
    copied,
    transportConfig,
    onCopyInvite: () => void copyInvite(),
    onOpenQr: () => setQrOpen(true),
    onPasswordDraftChange: () => {},
    onApplySettings: () => {},
    onTogglePublic: () => {},
    publicToggleBusy: false,
    replayBusy: false,
    replayError: null,
    onToggleReplay: () => {},
    sensorPermission,
  };

  return (
    <div className="h-[100dvh] w-[100dvw] overflow-hidden bg-black" data-connection-status={status}>
      <RoomFrame
        pkg={state.pkg}
        port={state.port}
        label={intl.formatMessage({ id: 'peer.playerView' })}
        role={intl.formatMessage({ id: 'peer.role.player' })}
        fullscreen
        onExitFullscreen={() => setLeaveConfirmOpen(true)}
        onFullscreenMore={() => setControlsOpen(true)}
        exitAriaLabelId="peer.join.exitAria"
        exitTitleId="peer.join.exitTitle"
        onSensorPermissionChange={state.pkg.manifest.permissions?.sensors?.length ? onSensorPermissionChange : undefined}
      />
      <RoomControlsSheet
        open={controlsOpen}
        onOpenChange={setControlsOpen}
        props={shareControlsProps}
        showSettings={false}
        showAdmissionStatus={false}
        sheetTitleId="peer.share.sheetTitle"
        sheetDescriptionId="peer.share.sheetDescription"
      />
      <InviteQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        inviteUrl={inviteUrl}
        inviterName={localUser.name}
        roomTitle={state.roomTitle}
      />
      <LeaveRoomConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        onConfirm={leaveRoom}
      />
    </div>
  );
}

function LeaveRoomConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle><FormattedMessage id="peer.join.leaveTitle" /></DialogTitle>
          <DialogDescription><FormattedMessage id="peer.join.leaveDescription" /></DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <FormattedMessage id="peer.join.leaveCancel" />
          </Button>
          <Button onClick={onConfirm}>
            <FormattedMessage id="peer.join.leaveConfirm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function lobbyInput(
  pkg: RoomPackage,
  connectionInfo: string,
  transportConfig: TransportConfig,
  settings: HostRoomSettings,
  admission: RoomAdmissionStatus,
): LobbyRoomInput {
  return {
    roomId: pkg.manifest.id,
    connectionInfo,
    transportConfig,
    title: settings.title.trim() || pkg.manifest.name,
    packageName: pkg.manifest.name,
    playerCount: admission.activePlayers,
    maxPlayers: admission.maxPlayers,
    joinable: admission.joinable,
    credentialRequired: Boolean(settings.password),
  };
}

function RoomError({ message }: { message: string }) {
  const intl = useIntl();
  const friendlyMessage = formatRoomError(intl, message);
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,211,55,0.25),transparent_34rem)] p-6">
      <Card className="w-[min(440px,100%)] gap-3 p-[26px] text-center">
        <h2 className="text-xl font-semibold"><FormattedMessage id="peer.error.title" /></h2>
        <p className="leading-[1.6] text-muted-foreground">{friendlyMessage}</p>
        <Button asChild variant="outline"><a href="#/"><FormattedMessage id="peer.error.backToLobby" /></a></Button>
      </Card>
    </div>
  );
}
