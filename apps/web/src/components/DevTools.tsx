import { useEffect, useRef, useState } from 'react';
import type {
  HostRuntime,
  MessageLogEntry,
  Player,
  RoomErrorPayload,
  SnapshotPayload,
} from '@parti/core';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';

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
      host.errors.on((e) => setErrors((prev) => [...prev, e].slice(-50))),
    ];
    return () => offs.forEach((off) => off());
  }, [host]);

  const sendManual = () => {
    let parsed: unknown = {};
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch {
      alert('payload 不是合法 JSON');
      return;
    }
    host.submitLocalAction(action, parsed);
  };

  return (
    <Card className="devtools">
      <h3>DevTools</h3>
      <div className="meta-line">
        transport: <b>{transportName}</b> · packageHash:{' '}
        <code>{packageHash.slice(0, 12)}…</code> · stateVersion:{' '}
        <b>{snapshot.version}</b> · hash: <code>{snapshot.stateHash}</code>
      </div>

      <div className="dev-grid">
        <Card className="dev-section">
          <h4>玩家 ({players.length})</h4>
          <ul className="players">
            {players.map((p) => (
              <li key={p.id}>
                <span>
                  {p.name} {p.role === 'host' ? '👑' : ''}
                </span>
                <Badge variant={p.status === 'offline' ? 'destructive' : 'secondary'}>{p.status}</Badge>
              </li>
            ))}
          </ul>

          <h4 style={{ marginTop: 14 }}>手动发送 action（以 host 身份）</h4>
          <div className="manual">
            <Input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="action"
            />
            <Input
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder="payload JSON"
            />
            <Button onClick={sendManual}>发送</Button>
          </div>
        </Card>

        <Card className="dev-section">
          <h4>当前 State (v{snapshot.version})</h4>
          <pre className="state">{JSON.stringify(snapshot.state, null, 2)}</pre>
        </Card>

        <Card className="dev-section">
          <h4>消息日志</h4>
          <div className="log">
            {log.map((e, i) => (
              <div className="log-row" key={i}>
                <span className={e.dir === 'in' ? 'dir-in' : 'dir-out'}>
                  {e.dir === 'in' ? '⬅ in ' : '➡ out'}
                </span>{' '}
                <span className="type">{e.message.type}</span>{' '}
                <span className="meta">
                  seq={e.message.seq} {e.message.channel}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="dev-section">
          <h4>Worker / 错误日志</h4>
          <div className="log">
            {errors.map((e, i) => (
              <div className="log-row error" key={`e${i}`}>
                ✖ {e.code}: {e.message}
              </div>
            ))}
            {logs.map((l, i) => (
              <div className="log-row" key={`l${i}`}>
                · {l}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Card>
  );
}
