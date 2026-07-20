import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { ArrowLeftIcon } from 'lucide-react';
import { GithubIcon } from '@/components/icons/GithubIcon';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Lobby } from './pages/Lobby';
import { loadLocalUser } from './lib/localUser';
import { UserSettings } from './components/UserSettings';
import { TransportIndicator } from './components/TransportIndicator';
import { PageFullscreenProvider, usePageFullscreen } from './components/PageFullscreen';
import { useLocale } from './i18n/LocaleProvider';
import { ENABLE_REPLAYS } from './lib/featureFlags';
import { deleteRoomSnapshot } from './lib/customRooms';

const EditorView = lazy(() => import('./pages/EditorView').then((module) => ({ default: module.EditorView })));
const LocalRoomView = lazy(() => import('./pages/LocalRoomView').then((module) => ({ default: module.LocalRoomView })));
const PeerRoomView = lazy(() => import('./pages/PeerRoomView').then((module) => ({ default: module.PeerRoomView })));
const ReplayPage = ENABLE_REPLAYS
  ? lazy(() => import('./replays/ReplayPage'))
  : null;

/** 极简 hash 路由：#/ 大厅 / #/editor 创作 / #/peer/... 联机。 */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** 从联机房间路由解析 roomId（host/join 均为第三段），非联机房间返回 null。 */
function peerRoomIdOf(hash: string): string | null {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  return parts[0] === 'peer' || parts[0] === 'online' ? (parts[2] ?? null) : null;
}

/** 仅返回当前浏览器拥有的房间；加入别人的房间不拥有其 snapshot。 */
function ownedRoomIdOf(hash: string): string | null {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  if (parts[0] === 'local') return parts[1] ?? null;
  if ((parts[0] === 'peer' || parts[0] === 'online') && parts[1] === 'host') {
    return parts[2] ?? null;
  }
  return null;
}

function AppLayout() {
  const hash = useHashRoute();
  const { locale } = useLocale();
  const intl = useIntl();
  const [user, setUser] = useState(() => loadLocalUser(undefined, locale));
  const { fullscreen, setFullscreen } = usePageFullscreen();

  useEffect(() => {
    setUser(loadLocalUser(undefined, locale));
  }, [locale]);

  useEffect(() => {
    setFullscreen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [hash, setFullscreen]);

  // 离开联机房间（回大厅 / 进入其它房间）时清除该房间的会话，
  // 使后续再进入使用全新数据。刷新是整页重载、不触发 hashchange，故不受影响。
  const prevPeerRoom = useRef<string | null>(peerRoomIdOf(hash));
  const prevOwnedRoom = useRef<string | null>(ownedRoomIdOf(hash));
  useEffect(() => {
    const cur = peerRoomIdOf(hash);
    const prev = prevPeerRoom.current;
    if (prev && prev !== cur) {
      void import('./lib/PeerRoomSession').then(({ clearRoomSession }) => clearRoomSession(prev));
    }
    prevPeerRoom.current = cur;

    const owned = ownedRoomIdOf(hash);
    const previousOwned = prevOwnedRoom.current;
    if (previousOwned && previousOwned !== owned) {
      void deleteRoomSnapshot(previousOwned);
    }
    prevOwnedRoom.current = owned;
  }, [hash]);

  const route = hash.replace(/^#/, '');
  const parts = route.split('/').filter(Boolean); // e.g. ['local','counter']
  const isPlayerRoute = (parts[0] === 'peer' || parts[0] === 'online') && parts[1] === 'join';
  const isLobbyRoute = parts.length === 0;

  let view;
  if (parts[0] === 'editor') {
    view = <EditorView />;
  } else if (parts[0] === 'local' && parts[1]) {
    view = <LocalRoomView roomId={parts[1]} />;
  } else if (parts[0] === 'peer' || parts[0] === 'online') {
    view = <PeerRoomView />;
  } else if (ReplayPage && parts[0] === 'replays') {
    view = <ReplayPage />;
  } else {
    view = <Lobby />;
  }

  return (
    <div>
      {!isPlayerRoute && !fullscreen && (
        <header className="sticky top-0 z-30 border-b border-border/80 bg-card/90 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
            <a
              className="inline-flex shrink-0 items-center gap-2 rounded-lg text-lg font-extrabold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              href="#/"
              aria-label={intl.formatMessage({ id: 'app.header.backToLobby' })}
            >
              <Logo />
              <span className="hidden sm:inline">Parti</span>
            </a>
            <Button asChild variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-foreground">
              <a
                href="https://github.com/glink25/Parti"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={intl.formatMessage({ id: 'app.header.github' })}
                title={intl.formatMessage({ id: 'app.header.github' })}
              >
                <GithubIcon />
              </a>
            </Button>
            {!isLobbyRoute && (
              <Button asChild variant="ghost" size="sm" className="ml-1 gap-1.5 text-muted-foreground sm:ml-4">
                <a href="#/">
                  <ArrowLeftIcon data-icon="inline-start" />
                  {intl.formatMessage({ id: 'app.header.back' })}
                </a>
              </Button>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <TransportIndicator />
              {isLobbyRoute && <UserSettings user={user} onChange={setUser} />}
            </div>
          </div>
        </header>
      )}
      <main
        className={
          isPlayerRoute || fullscreen
            ? 'min-h-[100dvh]'
            : 'min-h-[calc(100vh-64px)] px-4 pt-7 pb-12 md:px-6 md:pt-10 md:pb-16'
        }
      >
        <Suspense fallback={null}>{view}</Suspense>
      </main>
    </div>
  );
}

export function App() {
  return (
    <PageFullscreenProvider>
      <AppLayout />
      <Toaster />
    </PageFullscreenProvider>
  );
}
