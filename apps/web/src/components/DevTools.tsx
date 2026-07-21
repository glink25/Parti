import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type {
  HostRuntime,
  MessageLogEntry,
  Player,
  RoomErrorPayload,
  SnapshotPayload,
} from '@parti/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function formatErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail, null, 2) ?? String(detail);
  } catch {
    return String(detail);
  }
}

/** 房间调试面板 (GOAL.md §15.1) —— 订阅 HostRuntime 的事件总线。 */
export function DevTools({
  host,
  packageHash,
  transportName,
}: {
  host: HostRuntime;
  packageHash: string;
  transportName: string;
}) {
  const intl = useIntl();
  const [players, setPlayers] = useState<Player[]>(() => host.listPlayers());
  const [snapshot, setSnapshot] = useState<SnapshotPayload>(() =>
    host.currentSnapshot(),
  );
  const [log, setLog] = useState<MessageLogEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [errors, setErrors] = useState<RoomErrorPayload[]>([]);
  const [action, setAction] = useState('increment');
  const [payload, setPayload] = useState('{}');
  const logBuf = useRef<MessageLogEntry[]>([]);
  useEffect(() => {
    const offs = [
      host.playersChanged.on((p) => setPlayers([...p])),
      host.localState.on((s) => setSnapshot(s)),
      host.messageLog.on((e) => {
        logBuf.current = [...logBuf.current, e].slice(-200);
        setLog(logBuf.current);
      }),
      host.logs.on((args) =>
        setLogs((prev) => [...prev, args.map(String).join(' ')].slice(-100)),
      ),
      host.errors.on((e) => {
        console.error('[DevTools]', e.code, e.message, e.detail ?? e);
        setErrors((prev) => [...prev, e].slice(-50));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [host]);

  const sendManual = () => {
    let parsed: unknown = {};
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch {
      alert(intl.formatMessage({ id: 'devTools.invalidPayload' }));
      return;
    }
    host.submitLocalAction(action, parsed);
  };

  return (
    <Card className="mt-[18px] rounded-[16px] border-border bg-surface p-4">
      <h3 className="mb-2.5 text-sm font-semibold"><FormattedMessage id="devTools.title" /></h3>
      <div className="my-1 text-[11px] text-muted-foreground">
        transport: <b>{transportName}</b> · packageHash:{' '}
        <code>{packageHash.slice(0, 12)}…</code> · stateVersion:{' '}
        <b>{snapshot.version}</b> · hash: <code>{snapshot.stateHash}</code>
      </div>

      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <Card className="rounded-[10px] border-border bg-surface-2 p-2.5">
          <h4 className="mb-2 text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
            {intl.formatMessage({ id: 'devTools.players' }, { count: players.length })}
          </h4>
          <ul className="m-0 list-none p-0">
            {players.map((p) => (
              <li key={p.id} className="flex justify-between border-b border-dashed border-border py-1 text-[11px]">
                <span>
                  {p.name} {p.role === 'host' ? '👑' : ''}
                </span>
                <Badge variant={p.status === 'offline' ? 'destructive' : 'secondary'}>{p.status}</Badge>
              </li>
            ))}
          </ul>

          <h4 className="mt-3.5 mb-2 text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
            <FormattedMessage id="devTools.manualAction" />
          </h4>
          <div className="mt-2 flex gap-1.5">
            <Input
              className="min-w-0 flex-1 text-[10px]"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="action"
            />
            <Input
              className="min-w-0 flex-1 text-[10px]"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder="payload JSON"
            />
            <Button onClick={sendManual}><FormattedMessage id="devTools.send" /></Button>
          </div>
        </Card>

        <Card className="rounded-[10px] border-border bg-surface-2 p-2.5">
          <h4 className="mb-2 text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
            {intl.formatMessage({ id: 'devTools.currentState' }, { version: snapshot.version })}
          </h4>
          <pre className="m-0 max-h-[220px] overflow-auto font-mono text-[11px] text-success">{JSON.stringify(snapshot.state, null, 2)}</pre>
        </Card>

        <Card className="rounded-[10px] border-border bg-surface-2 p-2.5">
          <h4 className="mb-2 text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
            <FormattedMessage id="devTools.messageLog" />
          </h4>
          <div className="flex max-h-[220px] flex-col-reverse overflow-auto font-mono text-[10px]">
            {log.map((e, i) => (
              <div className="border-b border-dashed border-border py-0.5" key={i}>
                <span className={e.dir === 'in' ? 'text-primary-bright' : 'text-success'}>
                  {e.dir === 'in' ? '⬅ in ' : '➡ out'}
                </span>{' '}
                <span>{e.message.type}</span>{' '}
                <span className="text-muted-foreground">
                  seq={e.message.seq} {e.message.channel}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="rounded-[10px] border-border bg-surface-2 p-2.5">
          <h4 className="mb-2 text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
            <FormattedMessage id="devTools.workerLog" />
          </h4>
          <div className="flex max-h-[220px] flex-col-reverse overflow-auto font-mono text-[10px]">
            {errors.map((e, i) => (
              <div className="border-b border-dashed border-border py-0.5 text-danger" key={`e${i}`}>
                <div>
                  ✖ {e.code}: {e.message}
                </div>
                {e.detail !== undefined && (
                  <pre className="m-0 mt-0.5 max-h-[120px] overflow-auto whitespace-pre-wrap text-[9px] opacity-80">
                    {formatErrorDetail(e.detail)}
                  </pre>
                )}
              </div>
            ))}
            {logs.map((l, i) => (
              <div className="border-b border-dashed border-border py-0.5" key={`l${i}`}>
                · {l}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Card>
  );
}
