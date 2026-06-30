import { useEffect, useRef, useState } from 'react';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import {
  UISandboxBridge,
  buildRoomDocument,
  type RoomClientPort,
} from '@parti/client-sdk';
import { Button } from '@/components/ui/button.js';

/**
 * 一个沙箱 iframe + UISandboxBridge。Room UI 运行在 sandbox="allow-scripts"
 * 的 iframe 中（默认最小权限，§12.1），通过 client-sdk 桥与 Runtime 通信。
 */
export function RoomFrame({
  html,
  port,
  label,
  role,
  expandable = false,
  immersive = false,
  onLog,
}: {
  html: string;
  port: RoomClientPort;
  label: string;
  role: string;
  expandable?: boolean;
  immersive?: boolean;
  onLog?: (args: unknown[]) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(false);
  const roomDocument = buildRoomDocument(html);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const bridge = new UISandboxBridge(iframe, port, {
      ...(onLog ? { onLog } : {}),
    });
    return () => bridge.dispose();
  }, [html, port, onLog]);

  useEffect(() => {
    if (!expanded) return;
    document.body.classList.add('room-expanded');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('room-expanded');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  return (
    <div className={`frame${expanded ? ' expanded' : ''}${immersive ? ' immersive' : ''}`}>
      {!immersive && (
        <div className="frame-label">
          <span>{label}</span>
          <div className="frame-tools">
            <span className="role">{role}</span>
            {expandable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="expand-button"
                aria-label={expanded ? '退出全屏展示' : '全屏展示房间'}
                title={expanded ? '退出全屏（Esc）' : '全屏展示'}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
                {expanded ? '退出全屏' : '全屏展示'}
              </Button>
            )}
          </div>
        </div>
      )}
      <iframe ref={ref} srcDoc={roomDocument} sandbox="allow-scripts" title={label} />
    </div>
  );
}
