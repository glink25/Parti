import { useEffect, useRef, useState } from 'react';
import { Lobby } from './pages/Lobby.js';
import { LocalRoomView } from './pages/LocalRoomView.js';
import { PeerRoomView } from './pages/PeerRoomView.js';
import { EditorView } from './pages/EditorView.js';
import { clearRoomSession } from './lib/PeerRoomSession.js';

/** 极简 hash 路由：#/ 大厅 / #/local/<roomId> 本地预览 / #/peer/... 联机 */
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
  return parts[0] === 'peer' ? (parts[2] ?? null) : null;
}

export function App() {
  const hash = useHashRoute();

  // 离开联机房间（回大厅 / 进入其它房间）时清除该房间的会话，
  // 使后续再进入使用全新数据。刷新是整页重载、不触发 hashchange，故不受影响。
  const prevPeerRoom = useRef<string | null>(peerRoomIdOf(hash));
  useEffect(() => {
    const cur = peerRoomIdOf(hash);
    const prev = prevPeerRoom.current;
    if (prev && prev !== cur) clearRoomSession(prev);
    prevPeerRoom.current = cur;
  }, [hash]);

  const route = hash.replace(/^#/, '');
  const parts = route.split('/').filter(Boolean); // e.g. ['local','counter']

  let view;
  if (parts[0] === 'editor') {
    view = <EditorView />;
  } else if (parts[0] === 'local' && parts[1]) {
    view = <LocalRoomView roomId={parts[1]} />;
  } else if (parts[0] === 'peer') {
    view = <PeerRoomView />;
  } else {
    view = <Lobby />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          Parti
        </a>
        <span className="tagline">多人互动房间 Runtime · MVP</span>
      </header>
      <main>{view}</main>
    </div>
  );
}
