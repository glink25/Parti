import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { CloudIcon, PlusIcon, SparklesIcon, WifiIcon, WifiOffIcon } from 'lucide-react';
import {
  subscribeLanRooms,
  type LanDiscoveredRoom,
  type LanDiscoveryStatus,
} from '@parti/transport-lan';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JoinLinkInput } from '@/components/JoinLinkInput';
import { ScanJoinButton } from '@/components/ScanJoinButton';
import {
  LobbyClient,
  lobbyServiceUrl,
  type LobbyRoom,
} from '../lib/lobbyApi';
import { buildJoinHashRoute, navigateToPeerJoin } from '../lib/peerRoutes';
import { ENABLE_REPLAYS } from '../lib/featureFlags';
import {
  getLanDiscoveryConfig,
  TRANSPORT_PROFILES_CHANGED_EVENT,
  type TransportConfig,
} from '../lib/transportConfig';

/** 面向玩家的在线大厅。创作草稿与开发预览不在这里展示。 */
export function Lobby() {
  const intl = useIntl();
  const [online, setOnline] = useState<LobbyRoom[]>([]);
  const [onlineStatus, setOnlineStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [lanRooms, setLanRooms] = useState<LanDiscoveredRoom[]>([]);
  const [lanStatus, setLanStatus] = useState<LanDiscoveryStatus>('connecting');
  const [lanConfig, setLanConfig] = useState(() => getLanDiscoveryConfig());
  const lanServerUrl = lanConfig.serverUrl;

  useEffect(() => {
    const refreshConfig = () => setLanConfig(getLanDiscoveryConfig());
    window.addEventListener(TRANSPORT_PROFILES_CHANGED_EVENT, refreshConfig);
    window.addEventListener('storage', refreshConfig);
    return () => {
      window.removeEventListener(TRANSPORT_PROFILES_CHANGED_EVENT, refreshConfig);
      window.removeEventListener('storage', refreshConfig);
    };
  }, []);

  useEffect(() => {
    const baseUrl = lobbyServiceUrl();
    if (!baseUrl) {
      setOnlineStatus('offline');
      return;
    }
    const client = new LobbyClient(baseUrl);
    const refresh = () => {
      client
        .listRooms()
        .then((rooms) => {
          setOnline(rooms);
          setOnlineStatus('ready');
        })
        .catch(() => setOnlineStatus('offline'));
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setLanStatus('connecting');
    const subscription = subscribeLanRooms({
      ...(lanServerUrl ? { serverUrl: lanServerUrl } : {}),
      onRooms: setLanRooms,
      onStatus: setLanStatus,
    });
    return () => subscription.close();
  }, [lanServerUrl]);

  const emptyState =
    'flex min-h-[250px] flex-col items-center justify-center gap-1 rounded-[22px] border border-dashed border-border-strong bg-surface/75 p-9 text-center text-muted-foreground';

  return (
    <div className="mx-auto w-[min(1240px,100%)]">
      <section className="relative mb-[42px] flex min-h-[260px] items-end justify-between gap-8 overflow-hidden rounded-[28px] border border-border bg-[linear-gradient(115deg,rgba(255,215,64,0.42),rgba(255,253,247,0.94)_52%,rgba(255,235,143,0.32)),var(--surface)] p-12 shadow-soft max-md:min-h-[310px] max-md:flex-col max-md:items-start max-md:justify-end max-md:rounded-[22px] max-md:p-7">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[-65%] right-[7%] size-[310px] rounded-full border-[55px] border-[rgba(199,153,0,0.08)]"
        />
        <div className="relative">
          <span className="mb-2.5 block text-[11px] font-extrabold tracking-[0.16em] text-primary-bright">PARTI ONLINE</span>
          <h1 className="mb-3 text-[clamp(38px,6vw,68px)] leading-[0.98] font-extrabold tracking-[-0.055em]">
            <FormattedMessage id="lobby.hero.title" />
          </h1>
          <p className="max-w-[540px] text-base leading-[1.7] text-muted-foreground">
            <FormattedMessage id="lobby.hero.description" />
          </p>
        </div>
        <div className="relative flex flex-col gap-4 max-md:w-full">
          <div className="flex items-start gap-2 max-md:w-full">
            <JoinLinkInput />
            <ScanJoinButton />
          </div>
          <Button asChild size="lg" className="h-12 rounded-xl px-5 shadow-lg shadow-amber-500/15 max-md:w-full">
            <a href="#/editor"><PlusIcon data-icon="inline-start" /><FormattedMessage id="lobby.hero.createRoom" /></a>
          </Button>
          {ENABLE_REPLAYS && <Button asChild variant="outline" className="max-md:w-full"><a href="#/replays"><FormattedMessage id="replays.nav" /></a></Button>}
        </div>
      </section>

      <div className="mb-[18px] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-success shadow-[0_0_0_5px_rgba(81,219,147,0.11)]" />
          <h2 className="text-xl font-semibold"><FormattedMessage id="lobby.live.title" /></h2>
        </div>
        {onlineStatus === 'ready' && (
          <span className="text-xs text-muted-foreground">
            {intl.formatMessage({ id: 'lobby.live.roomCount' }, { count: online.length })}
          </span>
        )}
      </div>

      {onlineStatus === 'loading' && <div className={emptyState}><FormattedMessage id="lobby.loading" /></div>}
      {onlineStatus === 'offline' && (
        <Card className={emptyState}>
          <CloudIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground"><FormattedMessage id="lobby.offline.title" /></h3>
          <p className="mb-[18px]"><FormattedMessage id="lobby.offline.description" /></p>
        </Card>
      )}
      {online.length === 0 && onlineStatus === 'ready' && (
        <Card className={emptyState}>
          <SparklesIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground"><FormattedMessage id="lobby.empty.title" /></h3>
          <p className="mb-[18px]"><FormattedMessage id="lobby.empty.description" /></p>
        </Card>
      )}
      {online.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {online.map((room) => (
            <Card
              className="gap-3 rounded-[18px] border-border bg-[linear-gradient(145deg,var(--surface-2),var(--surface))] py-5 shadow-[0_14px_35px_rgba(91,72,15,0.08)]"
              key={room.listingId}
            >
              <CardHeader className="flex items-start justify-between gap-3 px-5">
                <div><CardTitle className="text-lg">{room.title}</CardTitle><CardDescription className="mt-1">{room.packageName}</CardDescription></div>
                {room.credentialRequired && <Badge variant="secondary"><FormattedMessage id="lobby.room.passwordRequired" /></Badge>}
              </CardHeader>
              <CardFooter className="bg-transparent border-none flex items-center justify-between gap-3 p-2">
                <span className="text-xs text-muted-foreground">
                  <span aria-hidden="true" className="text-[8px] text-success">●</span>{' '}
                  {room.maxPlayers === null
                    ? intl.formatMessage({ id: 'lobby.room.playersOnline' }, { count: room.playerCount })
                    : intl.formatMessage({ id: 'lobby.room.playersCapacity' }, { current: room.playerCount, max: room.maxPlayers })}
                </span>
                <Button
                  disabled={!room.joinable}
                  onClick={() => {
                    if (!room.joinable) return;
                    const connectionInfo = room.connectionInfo ?? room.hostPeerId;
                    if (!connectionInfo) return;
                    navigateToPeerJoin(buildJoinHashRoute(room.roomId, connectionInfo, undefined, room.transportConfig ?? { adapter: 'peerjs' }));
                  }}
                >
                  {room.joinable ? (
                    <FormattedMessage id="lobby.room.join" />
                  ) : (
                    <FormattedMessage id="lobby.room.full" />
                  )}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10 mb-[18px] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <WifiIcon className="size-4 text-primary-bright" aria-hidden="true" />
          <h2 className="text-xl font-semibold"><FormattedMessage id="lobby.lan.title" /></h2>
        </div>
        {lanStatus === 'ready' && (
          <span className="text-xs text-muted-foreground">
            {intl.formatMessage({ id: 'lobby.live.roomCount' }, { count: lanRooms.length })}
          </span>
        )}
      </div>

      {lanStatus === 'connecting' && <div className={emptyState}><FormattedMessage id="lobby.lan.loading" /></div>}
      {lanStatus === 'offline' && (
        <Card className={emptyState}>
          <WifiOffIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground"><FormattedMessage id="lobby.lan.offlineTitle" /></h3>
          <p className="mb-[18px]"><FormattedMessage id="lobby.lan.offlineDescription" /></p>
        </Card>
      )}
      {lanRooms.length === 0 && lanStatus === 'ready' && (
        <Card className={emptyState}>
          <WifiIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground"><FormattedMessage id="lobby.lan.emptyTitle" /></h3>
          <p className="mb-[18px]"><FormattedMessage id="lobby.lan.emptyDescription" /></p>
        </Card>
      )}
      {lanRooms.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {lanRooms.map((room) => (
            <RoomCard
              key={`${room.hostId}:${room.roomId}`}
              room={room}
              transportConfig={lanConfig}
              connectionInfo={room.hostId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoomCard({
  room,
  transportConfig,
  connectionInfo,
}: {
  room: Pick<LobbyRoom, 'roomId' | 'title' | 'packageName' | 'playerCount' | 'maxPlayers' | 'joinable' | 'credentialRequired'>;
  transportConfig: TransportConfig;
  connectionInfo: string;
}) {
  const intl = useIntl();
  return (
    <Card className="gap-3 rounded-[18px] border-border bg-[linear-gradient(145deg,var(--surface-2),var(--surface))] py-5 shadow-[0_14px_35px_rgba(91,72,15,0.08)]">
      <CardHeader className="flex items-start justify-between gap-3 px-5">
        <div><CardTitle className="text-lg">{room.title}</CardTitle><CardDescription className="mt-1">{room.packageName}</CardDescription></div>
        {room.credentialRequired && <Badge variant="secondary"><FormattedMessage id="lobby.room.passwordRequired" /></Badge>}
      </CardHeader>
      <CardFooter className="bg-transparent border-none flex items-center justify-between gap-3 p-2">
        <span className="text-xs text-muted-foreground">
          <span aria-hidden="true" className="text-[8px] text-success">●</span>{' '}
          {room.maxPlayers === null
            ? intl.formatMessage({ id: 'lobby.room.playersOnline' }, { count: room.playerCount })
            : intl.formatMessage({ id: 'lobby.room.playersCapacity' }, { current: room.playerCount, max: room.maxPlayers })}
        </span>
        <Button
          disabled={!room.joinable}
          onClick={() => {
            if (!room.joinable) return;
            navigateToPeerJoin(buildJoinHashRoute(room.roomId, connectionInfo, undefined, transportConfig));
          }}
        >
          <FormattedMessage id={room.joinable ? 'lobby.room.join' : 'lobby.room.full'} />
        </Button>
      </CardFooter>
    </Card>
  );
}
