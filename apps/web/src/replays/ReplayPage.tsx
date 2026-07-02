import { useEffect, useMemo, useState } from 'react';
import { FormattedDate, FormattedMessage, FormattedTime, useIntl } from 'react-intl';
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon, Trash2Icon } from 'lucide-react';
import type { RoomClientPort } from '@parti/client-sdk';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RoomFrame } from '@/components/RoomFrame';
import { deleteReplay, getReplay, getReplayPackage, listReplays } from './storage';
import type { ReplayRecord, ReplayStep } from './types';

export default function ReplayPage() {
  const id = window.location.hash.replace(/^#\/replays\/?/, '') || null;
  return id ? <ReplayDetail id={decodeURIComponent(id)} /> : <ReplayList />;
}

function ReplayList() {
  const [records, setRecords] = useState<ReplayRecord[] | null>(null);
  useEffect(() => { void listReplays().then(setRecords); }, []);
  if (!records) return <Loading />;
  return (
    <div className="mx-auto w-[min(1100px,100%)]">
      <a className="mb-6 block w-max text-sm text-muted-foreground hover:text-foreground" href="#/"><FormattedMessage id="replays.back" /></a>
      <h1 className="text-4xl font-extrabold tracking-tight"><FormattedMessage id="replays.title" /></h1>
      <p className="mt-2 text-muted-foreground"><FormattedMessage id="replays.description" /></p>
      {records.length === 0 ? (
        <Card className="mt-8 border-dashed p-10 text-center text-muted-foreground"><FormattedMessage id="replays.empty" /></Card>
      ) : (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {records.map((record) => <ReplayCard key={record.id} record={record} onDeleted={() => setRecords((all) => all?.filter((item) => item.id !== record.id) ?? [])} />)}
        </div>
      )}
    </div>
  );
}

function ReplayCard({ record, onDeleted }: { record: ReplayRecord; onDeleted: () => void }) {
  return (
    <Card className="gap-3 rounded-[18px]">
      <CardHeader>
        <div className="flex items-start justify-between gap-3"><CardTitle>{record.title}</CardTitle><Badge variant="secondary"><FormattedMessage id={`replays.${record.status}`} /></Badge></div>
        <CardDescription>{record.roomName}</CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        <FormattedDate value={record.startedAt} /> · <FormattedTime value={record.startedAt} /> · {record.steps.length} steps
      </CardContent>
      <CardFooter className="justify-between bg-transparent p-2">
        <Button asChild><a href={`#/replays/${encodeURIComponent(record.id)}`}><FormattedMessage id="replays.open" /></a></Button>
        <Button variant="ghost" size="icon" aria-label="delete" onClick={() => void deleteReplay(record.id).then(onDeleted)}><Trash2Icon /></Button>
      </CardFooter>
    </Card>
  );
}

function ReplayDetail({ id }: { id: string }) {
  const intl = useIntl();
  const [data, setData] = useState<{ record: ReplayRecord; pkg: NonNullable<Awaited<ReturnType<typeof getReplayPackage>>> } | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    void getReplay(id).then(async (record) => {
      if (!record) return setData(null);
      const pkg = await getReplayPackage(record.packageHash);
      const html = pkg?.files[pkg.manifest.entry.ui];
      setData(pkg && html !== undefined ? { record, pkg } : null);
    });
  }, [id]);
  useEffect(() => {
    if (!playing || !data) return;
    const timer = window.setInterval(() => setIndex((current) => {
      if (current >= data.record.steps.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 700);
    return () => window.clearInterval(timer);
  }, [data, playing]);
  const snapshot = useMemo(() => {
    if (!data) return undefined;
    for (let i = index; i >= 0; i -= 1) {
      const step = data.record.steps[i];
      if (step?.kind === 'snapshot') return step.snapshot.state;
    }
    return undefined;
  }, [data, index]);
  if (data === undefined) return <Loading />;
  if (data === null) return <div className="mx-auto max-w-xl"><a href="#/replays"><FormattedMessage id="replays.back" /></a><Card className="mt-6 p-8"><FormattedMessage id="replays.missing" /></Card></div>;
  const { record, pkg } = data;
  const step = record.steps[index];
  const port = createReplayPort(record.hostPlayerId, snapshot);
  return (
    <div className="mx-auto w-[min(1240px,100%)]">
      <a className="mb-5 block w-max text-sm text-muted-foreground hover:text-foreground" href="#/replays"><FormattedMessage id="replays.back" /></a>
      <div className="mb-5"><h1 className="text-3xl font-extrabold">{record.title}</h1><p className="mt-1 text-sm text-muted-foreground">{record.roomName}</p></div>
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-lg:grid-cols-1">
        <RoomFrame key={index} pkg={pkg} port={port} label={record.roomName} role={intl.formatMessage({ id: 'peer.role.host' })} className="min-h-[min(68vh,720px)]" />
        <Card className="gap-3">
          <CardHeader><CardTitle><FormattedMessage id="replays.step" values={{ current: index + 1, total: record.steps.length }} /></CardTitle><CardDescription>{step ? describeStep(step, intl) : ''}</CardDescription></CardHeader>
          <CardContent><pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 text-[11px]">{JSON.stringify(step, null, 2)}</pre></CardContent>
          <CardFooter className="grid grid-cols-3 gap-2 bg-transparent p-3">
            <Button variant="outline" disabled={index === 0} onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }}><SkipBackIcon /><FormattedMessage id="replays.previous" /></Button>
            <Button onClick={() => setPlaying((value) => !value)}>{playing ? <PauseIcon /> : <PlayIcon />}<FormattedMessage id={playing ? 'replays.pause' : 'replays.play'} /></Button>
            <Button variant="outline" disabled={index >= record.steps.length - 1} onClick={() => { setPlaying(false); setIndex((i) => Math.min(record.steps.length - 1, i + 1)); }}><FormattedMessage id="replays.next" /><SkipForwardIcon /></Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function createReplayPort(playerId: string, state: unknown): RoomClientPort {
  return { isReady: () => true, onReady: (cb) => { cb(); return () => {}; }, getPlayerId: () => playerId, getState: () => state, submitAction: () => {}, ready: () => {}, leave: () => {}, onState: () => () => {}, onEvent: () => () => {} };
}

function describeStep(step: ReplayStep, intl: ReturnType<typeof useIntl>): string {
  if (step.kind === 'snapshot') return intl.formatMessage({ id: 'replays.snapshot' }, { version: step.snapshot.version });
  if (step.kind === 'action') return intl.formatMessage({ id: 'replays.action' }, { player: step.playerId, action: step.action });
  if (step.kind === 'event') return intl.formatMessage({ id: 'replays.event' }, { event: step.event });
  if (step.kind === 'players') return intl.formatMessage({ id: 'replays.players' });
  return intl.formatMessage({ id: 'replays.message' }, { type: step.message.type });
}

function Loading() { return <div className="p-12 text-center text-muted-foreground"><FormattedMessage id="replays.loading" /></div>; }
