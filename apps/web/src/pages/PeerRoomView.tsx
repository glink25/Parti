import { useEffect, useRef, useState } from 'react';
import type { HostRuntime } from '@parti/core';
import type { RoomClientPort } from '@parti/client-sdk';
import { loadPackageFromUrl, type RoomPackage } from '@parti/room-packager';
import { RoomFrame } from '../components/RoomFrame.js';
import { DevTools } from '../components/DevTools.js';
import { createHostLocalPort } from '@parti/client-sdk';
import { createPeerHost, createPeerJoin } from '../lib/PeerRoomSession.js';
import { findRoom } from '../lib/rooms.js';

/** 解析 #/peer/host/<roomId> 或 #/peer/join/<roomId>/<hostPeerId> */
function parsePeerRoute(): { mode: 'host' | 'join'; roomId?: string; hostPeerId?: string } {
  const parts = window.location.hash.replace(/^#/, '').split('/').filter(Boolean);
  // ['peer','host','counter'] | ['peer','join','counter','<peerId>']
  if (parts[1] === 'join') {
    return { mode: 'join', roomId: parts[2], hostPeerId: parts[3] };
  }
  return { mode: 'host', roomId: parts[2] };
}

export function PeerRoomView() {
  const route = parsePeerRoute();
  if (route.mode === 'join') {
    return <PeerJoinView roomId={route.roomId} hostPeerId={route.hostPeerId} />;
  }
  return <PeerHostView roomId={route.roomId} />;
}

// --- Host ---

function PeerHostView({ roomId }: { roomId?: string }) {
  const [state, setState] = useState<{
    host: HostRuntime;
    pkg: RoomPackage;
    roomHtml: string;
    hostPeerId: string;
    port: RoomClientPort;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!roomId || started.current) return;
    started.current = true;
    (async () => {
      const entry = findRoom(roomId);
      if (!entry) throw new Error(`未知房间: ${roomId}`);
      const pkg = await loadPackageFromUrl(entry.baseUrl);
      const peerHost = await createPeerHost(pkg);
      setState({
        host: peerHost.host,
        pkg,
        roomHtml: peerHost.roomHtml,
        hostPeerId: peerHost.hostPeerId,
        port: createHostLocalPort(peerHost.host),
      });
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [roomId]);

  if (error) return <div className="card error">出错：{error} · <a href="#/">返回</a></div>;
  if (!state) return <div className="loading">正在创建 PeerJS 房间…</div>;

  const inviteUrl = `${location.origin}${location.pathname}#/peer/join/${roomId}/${state.hostPeerId}`;

  return (
    <div>
      <h2>PeerJS 房间（房主） · {state.pkg.manifest.name}</h2>
      <div className="card">
        <p className="meta-line">把邀请链接发给其他人（同一房间代码，packageHash 自动校验一致）：</p>
        <div className="invite">
          <input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => navigator.clipboard?.writeText(inviteUrl)}>复制</button>
          <a className="btn secondary" href={inviteUrl} target="_blank" rel="noreferrer">
            新标签页加入
          </a>
        </div>
      </div>

      <div className="room-stage" style={{ gridTemplateColumns: '1fr', maxWidth: 480 }}>
        <RoomFrame html={state.roomHtml} port={state.port} label="Host (你)" role="host" />
      </div>

      <DevTools host={state.host} packageHash={state.pkg.packageHash} transportName="peerjs" />
    </div>
  );
}

// --- Join ---

function PeerJoinView({ roomId, hostPeerId }: { roomId?: string; hostPeerId?: string }) {
  const [state, setState] = useState<{
    roomHtml: string;
    port: RoomClientPort;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('connecting');
  const started = useRef(false);

  useEffect(() => {
    if (!roomId || !hostPeerId || started.current) return;
    started.current = true;
    (async () => {
      const entry = findRoom(roomId);
      if (!entry) throw new Error(`未知房间: ${roomId}`);
      const pkg = await loadPackageFromUrl(entry.baseUrl);
      // createPeerJoin 内置断线自动重连：UI 拿到稳定 port，无需感知重连。
      const join = createPeerJoin(pkg, hostPeerId, 'Guest', {
        onStatus: (s) => setStatus(s),
        onFatal: (msg) => setError(msg),
      });
      setState({ roomHtml: join.roomHtml, port: join.port });
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [roomId, hostPeerId]);

  if (error) return <div className="card error">连接失败：{error} · <a href="#/">返回</a></div>;
  if (!state) return <div className="loading">正在连接房主（{status}）…</div>;

  const reconnecting = status === 'reconnecting';

  return (
    <div>
      <h2>PeerJS 房间（玩家）</h2>
      <p className="meta-line">
        连接状态：{status}
        {reconnecting && ' · 正在重连…'}
      </p>
      <div className="room-stage" style={{ gridTemplateColumns: '1fr', maxWidth: 480 }}>
        <RoomFrame html={state.roomHtml} port={state.port} label="你" role="player" />
      </div>
    </div>
  );
}
