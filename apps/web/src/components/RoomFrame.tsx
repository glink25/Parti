import { useEffect, useRef } from 'react';
import { Maximize2Icon } from 'lucide-react';
import {
  UISandboxBridge,
  buildRoomDocument,
  type RoomClientPort,
} from '@parti/client-sdk';
import { Button } from '@/components/ui/button.js';
import { RoomImmersiveCapsule } from '@/components/RoomImmersiveCapsule.js';
import { cn } from '@/lib/utils.js';

/**
 * 一个沙箱 iframe + UISandboxBridge。Room UI 运行在 sandbox="allow-scripts"
 * 的 iframe 中（默认最小权限，§12.1），通过 client-sdk 桥与 Runtime 通信。
 */
export function RoomFrame({
  html,
  port,
  label,
  role,
  fullscreen = false,
  onEnterFullscreen,
  onExitFullscreen,
  onFullscreenMore,
  onLog,
  className,
}: {
  html: string;
  port: RoomClientPort;
  label: string;
  role: string;
  fullscreen?: boolean;
  onEnterFullscreen?: () => void;
  onExitFullscreen?: () => void;
  onFullscreenMore?: () => void;
  onLog?: (args: unknown[]) => void;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
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
    if (!fullscreen || !onExitFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExitFullscreen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen, onExitFullscreen]);

  return (
    <div
      className={cn(
        'flex min-h-[300px] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-[0_22px_65px_rgba(91,72,15,0.12)]',
        fullscreen && 'h-[100dvh] w-[100dvw] min-h-0 rounded-none border-0 bg-black shadow-none',
        className,
      )}
    >
      {!fullscreen && (
        <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-border bg-surface py-[7px] pr-[9px] pl-4 text-[11px] font-bold text-muted-foreground">
          <span>{label}</span>
          <div className="flex items-center gap-2.5">
            <span className="text-[9px] font-semibold text-muted-foreground">{role}</span>
            {onEnterFullscreen && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg border-border bg-surface-3 px-2.5 text-[10px] text-foreground shadow-none"
                aria-label="全屏展示房间"
                title="全屏展示"
                onClick={onEnterFullscreen}
              >
                <Maximize2Icon />
                全屏展示
              </Button>
            )}
          </div>
        </div>
      )}
      {fullscreen && onExitFullscreen && (
        <RoomImmersiveCapsule
          onMore={onFullscreenMore}
          onExit={onExitFullscreen}
        />
      )}
      <iframe ref={ref} srcDoc={roomDocument} sandbox="allow-scripts" title={label} className="w-full flex-1 border-0 bg-white" />
    </div>
  );
}
