import { useEffect, useState } from 'react';
import { CloudIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.js';
import {
  LobbyClient,
  lobbyServiceUrl,
  type LobbyRoom,
} from '../lib/lobbyApi.js';

/** 面向玩家的在线大厅。创作草稿与开发预览不在这里展示。 */
export function Lobby() {
  const [online, setOnline] = useState<LobbyRoom[]>([]);
  const [onlineStatus, setOnlineStatus] = useState<'loading' | 'ready' | 'offline'>('loading');

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

  return (
    <div className="page-shell lobby-page">
      <section className="lobby-hero">
        <div>
          <span className="eyebrow">PARTI ONLINE</span>
          <h1>在线大厅</h1>
          <p>发现正在进行的房间，或者创建一个属于你们的欢乐现场。</p>
        </div>
        <Button asChild size="lg" className="h-12 rounded-xl px-5 shadow-lg shadow-amber-500/15">
          <a href="#/editor"><PlusIcon data-icon="inline-start" />创建联机房间</a>
        </Button>
      </section>

      <div className="section-heading">
        <div>
          <span className="live-dot" />
          <h2>正在进行</h2>
        </div>
        {onlineStatus === 'ready' && <span>{online.length} 个房间</span>}
      </div>

      {onlineStatus === 'loading' && <div className="empty-state">正在寻找可加入的房间…</div>}
      {onlineStatus === 'offline' && (
        <Card className="empty-state">
          <CloudIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3>大厅暂时无法连接</h3>
          <p>你仍然可以创建房间，通过邀请链接和朋友一起玩。</p>
        </Card>
      )}
      {online.length === 0 && onlineStatus === 'ready' && (
        <Card className="empty-state">
          <SparklesIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3>等待第一场派对</h3>
          <p>这里还没有公开房间，创建一个房间邀请朋友加入吧。</p>
          <Button asChild variant="outline"><a href="#/editor">创建房间</a></Button>
        </Card>
      )}
      {online.length > 0 && (
        <div className="room-list online-rooms">
          {online.map((room) => (
            <Card className="room-card gap-3 py-5" key={room.listingId}>
              <CardHeader className="room-title-line px-5">
                <div><CardTitle className="text-lg">{room.title}</CardTitle><CardDescription className="mt-1">{room.packageName}</CardDescription></div>
                {room.credentialRequired && <Badge variant="secondary">需密码</Badge>}
              </CardHeader>
              <CardContent className="px-5" />
              <CardFooter className="room-card-footer mx-5 px-0 pb-0">
                <span className="player-count">
                  <span aria-hidden="true">●</span> {room.playerCount}
                  {room.maxPlayers === null ? ' 人在线' : ` / ${room.maxPlayers} 人`}
                </span>
                <Button asChild={room.joinable} disabled={!room.joinable}>
                  {room.joinable ? <a href={`#/peer/join/${encodeURIComponent(room.roomId)}/${encodeURIComponent(room.hostPeerId)}`}>加入房间</a> : <span>房间已满</span>}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
