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
          <h1 className="mb-3 text-[clamp(38px,6vw,68px)] leading-[0.98] font-extrabold tracking-[-0.055em]">在线大厅</h1>
          <p className="max-w-[540px] text-base leading-[1.7] text-muted-foreground">发现正在进行的房间，或者创建一个属于你们的欢乐现场。</p>
        </div>
        <Button asChild size="lg" className="relative h-12 rounded-xl px-5 shadow-lg shadow-amber-500/15 max-md:w-full">
          <a href="#/editor"><PlusIcon data-icon="inline-start" />创建联机房间</a>
        </Button>
      </section>

      <div className="mb-[18px] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-success shadow-[0_0_0_5px_rgba(81,219,147,0.11)]" />
          <h2 className="text-xl font-semibold">正在进行</h2>
        </div>
        {onlineStatus === 'ready' && <span className="text-xs text-muted-foreground">{online.length} 个房间</span>}
      </div>

      {onlineStatus === 'loading' && <div className={emptyState}>正在寻找可加入的房间…</div>}
      {onlineStatus === 'offline' && (
        <Card className={emptyState}>
          <CloudIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground">大厅暂时无法连接</h3>
          <p className="mb-[18px]">你仍然可以创建房间，通过邀请链接和朋友一起玩。</p>
        </Card>
      )}
      {online.length === 0 && onlineStatus === 'ready' && (
        <Card className={emptyState}>
          <SparklesIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
          <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground">等待第一场派对</h3>
          <p className="mb-[18px]">这里还没有公开房间，创建一个房间邀请朋友加入吧。</p>
          <Button asChild variant="outline"><a href="#/editor">创建房间</a></Button>
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
                {room.credentialRequired && <Badge variant="secondary">需密码</Badge>}
              </CardHeader>
              <CardFooter className="bg-transparent border-none flex items-center justify-between gap-3 p-2">
                <span className="text-xs text-muted-foreground">
                  <span aria-hidden="true" className="text-[8px] text-success">●</span> {room.playerCount}
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
