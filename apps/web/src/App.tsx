import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { GithubIcon } from '@/components/icons/GithubIcon.js';
import { Logo } from '@/components/Logo.js';
import { Button } from '@/components/ui/button.js';
import { Lobby } from './pages/Lobby.js';
import { loadLocalUser } from './lib/localUser.js';
import { UserSettings } from './components/UserSettings.js';
import { PageFullscreenProvider, usePageFullscreen } from './components/PageFullscreen.js';
import { useLocale } from './i18n/LocaleProvider.js';
import { ENABLE_REPLAYS } from './lib/featureFlags.js';
import { deleteRoomSnapshot } from './lib/customRooms.js';

const EditorView = lazy(() => import('./pages/EditorView.js').then((module) => ({ default: module.EditorView })));
const LocalRoomView = lazy(() => import('./pages/LocalRoomView.js').then((module) => ({ default: module.LocalRoomView })));
const PeerRoomView = lazy(() => import('./pages/PeerRoomView.js').then((module) => ({ default: module.PeerRoomView })));
const ReplayPage = ENABLE_REPLAYS
  ? lazy(() => import('./replays/ReplayPage.js'))
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
      void import('./lib/PeerRoomSession.js').then(({ clearRoomSession }) => clearRoomSession(prev));
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
        <header className="sticky top-0 z-30 flex h-[62px] items-center gap-4 border-b border-border bg-card/85 px-[18px] backdrop-blur-lg md:h-[72px] md:px-[max(1.5rem,calc((100vw-1240px)/2))]">
          <a
            className="inline-flex items-center gap-2.5 rounded-md text-xl font-extrabold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href="#/"
            aria-label={intl.formatMessage({ id: 'app.header.backToLobby' })}
          >
            <Logo />
            <span>Parti</span>
          </a>
          <span className="hidden text-[13px] text-muted-foreground md:inline">
            <FormattedMessage id="app.header.tagline" />
          </span>
          <a
              href="https://github.com/glink25/Parti"
              target="_blank"
              rel="noopener noreferrer"
              className='size-4'
              aria-label={intl.formatMessage({ id: 'app.header.github' })}
            >
              <GithubIcon />
            </a>
          {isLobbyRoute && <UserSettings user={user} onChange={setUser} />}
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className={`${isLobbyRoute ? '' : 'ml-auto'} shrink-0 text-muted-foreground hover:text-foreground`}
          >
          </Button>
        </header>
      )}
      <main
        className={
          isPlayerRoute || fullscreen
            ? 'min-h-[100dvh]'
            : 'min-h-[calc(100vh-62px)] px-4 pt-7 pb-12 md:min-h-[calc(100vh-72px)] md:px-6 md:pt-12 md:pb-[72px]'
        }
      >
        <Suspense fallback={null}>{view}</Suspense>
      </main>
    </div>
  );
}

export function App() {
  return <PageFullscreenProvider><AppLayout /></PageFullscreenProvider>;
}
