import { useEffect, useState } from 'react';
import type { RoomClientPort } from '@parti/client-sdk';
import { type RoomPackage } from '@parti/room-packager';
import { RoomFrame } from '../components/RoomFrame.js';
import { DevTools } from '../components/DevTools.js';
import { LocalRoomSession } from '../lib/LocalRoomSession.js';
import { resolvePackage } from '../lib/rooms.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';

interface Seat {
  label: string;
  role: string;
  port: RoomClientPort;
}

interface Loaded {
  session: LocalRoomSession;
  pkg: RoomPackage;
  seats: Seat[];
}

/** 本地多人预览：一个 Host + 2 个虚拟玩家，全部经真实 worker / iframe 沙箱跑通。 */
export function LocalRoomView({ roomId }: { roomId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let session: LocalRoomSession | undefined;

    (async () => {
      const pkg = await resolvePackage(roomId);
      session = await LocalRoomSession.create(pkg);
      const hostPort = session.hostPort();
      const p1 = await session.addPlayer('Alice');
      const p2 = await session.addPlayer('Bob');
      if (cancelled) {
        session.dispose();
        return;
      }
      setLoaded({
        session,
        pkg,
        seats: [
          { label: 'Host', role: 'host', port: hostPort },
          { label: 'Alice', role: 'player', port: p1 },
          { label: 'Bob', role: 'player', port: p2 },
        ],
      });
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      session?.dispose();
    };
  }, [roomId]);

  if (error) {
    return (
      <Card className="mx-auto max-w-lg p-6 text-destructive">加载失败：{error}<Button asChild variant="outline"><a href="#/">返回大厅</a></Button></Card>
    );
  }
  if (!loaded) {
    return <div className="loading">正在加载 Room Package 并启动 Runtime…</div>;
  }

  return (
    <div className="page-shell">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">本地多人预览 · {loaded.pkg.manifest.name}</h2>
        <Button asChild variant="outline"><a href="#/">← 返回大厅</a></Button>
      </div>
      <div className="room-stage">
        {loaded.seats.map((seat) => (
          <RoomFrame
            key={seat.label}
            html={loaded.session.roomHtml}
            port={seat.port}
            label={seat.label}
            role={seat.role}
          />
        ))}
      </div>
      <DevTools
        host={loaded.session.host}
        packageHash={loaded.pkg.packageHash}
        transportName="local"
      />
    </div>
  );
}
