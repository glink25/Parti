import { useEffect, useRef } from 'react';
import {
  UISandboxBridge,
  buildRoomDocument,
  type RoomClientPort,
} from '@parti/client-sdk';

/**
 * 一个沙箱 iframe + UISandboxBridge。Room UI 运行在 sandbox="allow-scripts"
 * 的 iframe 中（默认最小权限，§12.1），通过 client-sdk 桥与 Runtime 通信。
 */
export function RoomFrame({
  html,
  port,
  label,
  role,
  onLog,
}: {
  html: string;
  port: RoomClientPort;
  label: string;
  role: string;
  onLog?: (args: unknown[]) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    iframe.srcdoc = buildRoomDocument(html);
    const bridge = new UISandboxBridge(iframe, port, {
      ...(onLog ? { onLog } : {}),
    });
    return () => bridge.dispose();
  }, [html, port, onLog]);

  return (
    <div className="frame">
      <div className="frame-label">
        <span>{label}</span>
        <span className="role">{role}</span>
      </div>
      <iframe ref={ref} sandbox="allow-scripts" title={label} />
    </div>
  );
}
