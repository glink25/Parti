import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { RoomClientPort } from '@parti/client-sdk';
import { type RoomPackage } from '@parti/room-packager';
import { ROOM_FRAME_GRID_AREAS, RoomFrame, type RoomFrameGridKey } from '../components/RoomFrame';
import { DevTools } from '../components/DevTools';
import { LocalRoomSession } from '../lib/LocalRoomSession';
import { loadRoomSnapshot } from '../lib/customRooms';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Seat {
  label: string;
  role: string;
  port: RoomClientPort;
  gridKey: RoomFrameGridKey;
}

interface Loaded {
  session: LocalRoomSession;
  pkg: RoomPackage;
  seats: Seat[];
}

/** 本地多人预览：一个 Host + 2 个虚拟玩家，全部经真实 worker / iframe 沙箱跑通。 */
export function LocalRoomView({ roomId }: { roomId: string }) {
  const intl = useIntl();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let session: LocalRoomSession | undefined;

    (async () => {
      const pkg = await loadRoomSnapshot(roomId);
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
          {
            label: `${intl.formatMessage({ id: 'local.seat.host' })} · ${intl.formatMessage({ id: 'local.device.desktop' })}`,
            role: 'host', port: hostPort,
            gridKey: 'desktop',
          },
          {
            label: `${intl.formatMessage({ id: 'local.seat.alice' })} · ${intl.formatMessage({ id: 'local.device.tablet' })}`,
            role: 'player', port: p1,
            gridKey: 'tablet',
          },
          {
            label: `${intl.formatMessage({ id: 'local.seat.bob' })} · ${intl.formatMessage({ id: 'local.device.mobile' })}`,
            role: 'player', port: p2,
            gridKey: 'phone',
          },
        ],
      });
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      session?.dispose();
    };
  }, [intl, roomId]);

  if (error) {
    return (
      <Card className="mx-auto max-w-lg p-6 text-destructive">
        {intl.formatMessage({ id: 'local.loadFailed' }, { error })}
        <Button asChild variant="outline"><a href="#/"><FormattedMessage id="local.backToLobby" /></a></Button>
      </Card>
    );
  }
  if (!loaded) {
    return <div className="p-[22px] text-center text-[13px] text-muted-foreground"><FormattedMessage id="local.loading" /></div>;
  }

  return (
    <div className="mx-auto w-[min(1240px,100%)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">
          {intl.formatMessage({ id: 'local.title' }, { name: loaded.pkg.manifest.name })}
        </h2>
        <Button asChild variant="outline"><a href="#/"><FormattedMessage id="editor.backToLobby" /></a></Button>
      </div>
      <div
        className="mb-4 grid w-full grid-cols-10 grid-rows-12 gap-2"
        style={{ height: 'min(calc(160dvh - 200px), 1600px)' }}
      >
        {loaded.seats.map((seat) => (
          <RoomFrame
            key={seat.label}
            pkg={loaded.pkg}
            port={seat.port}
            label={seat.label}
            role={seat.role}
            style={ROOM_FRAME_GRID_AREAS[seat.gridKey]}
            viewport={{ fill: true }}
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
