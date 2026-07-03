import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useIntl } from 'react-intl';
import { Maximize2Icon } from 'lucide-react';
import {
  UISandboxBridge,
  type RoomClientPort,
} from '@parti/client-sdk';
import type { RoomPackage } from '@parti/room-packager';
import { Button } from '@/components/ui/button';
import { RoomImmersiveCapsule } from '@/components/RoomImmersiveCapsule';
import { cn } from '@/lib/utils';
import { createPackageUrl } from '@/lib/packageUiLoader';

export interface RoomFrameViewport {
  aspectRatio?: string;
  className?: string;
  fill?: boolean;
}

export const ROOM_FRAME_GRID_AREAS = {
  desktop: { gridArea: '1 / 1 / span 7 / span 7' },
  phone: { gridArea: '1 / 8 / span 7 / span 3' },
  tablet: { gridArea: '8 / 1 / span 3 / span 10' },
} as const satisfies Record<string, CSSProperties>;

export type RoomFrameGridKey = keyof typeof ROOM_FRAME_GRID_AREAS;

export function RoomFrame({
  pkg,
  port,
  label,
  role,
  fullscreen = false,
  onEnterFullscreen,
  onExitFullscreen,
  onFullscreenMore,
  onLog,
  className,
  style,
  viewport,
  exitAriaLabelId,
  exitTitleId,
}: {
  pkg: RoomPackage;
  port: RoomClientPort;
  label: string;
  role: string;
  fullscreen?: boolean;
  onEnterFullscreen?: () => void;
  onExitFullscreen?: () => void;
  onFullscreenMore?: () => void;
  onLog?: (args: unknown[]) => void;
  className?: string;
  style?: CSSProperties;
  viewport?: RoomFrameViewport;
  exitAriaLabelId?: string;
  exitTitleId?: string;
}) {
  const intl = useIntl();
  const ref = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<UISandboxBridge | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showMotionPermission, setShowMotionPermission] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setFrameUrl(null);
    setLoadError(null);
    void createPackageUrl(pkg).then((handle) => {
      if (cancelled) return handle.dispose();
      dispose = handle.dispose;
      setFrameUrl(handle.url);
    }).catch((reason: unknown) => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; dispose?.(); };
  }, [pkg]);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe || !frameUrl) return;
    const bridge = new UISandboxBridge(iframe, port, {
      ...(onLog ? { onLog } : {}),
      onOrientationHostGestureRequired: () => setShowMotionPermission(true),
    });
    bridgeRef.current = bridge;
    return () => {
      bridgeRef.current = null;
      bridge.dispose();
    };
  }, [frameUrl, port, onLog]);

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
      style={style}
      className={cn(
        'relative flex min-h-[300px] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-[0_22px_65px_rgba(91,72,15,0.12)]',
        viewport && 'min-h-0 w-full',
        viewport?.fill && 'h-full min-h-0',
        fullscreen && 'relative h-[100dvh] w-[100dvw] min-h-0 rounded-none border-0 bg-black shadow-none',
        viewport?.className,
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
                aria-label={intl.formatMessage({ id: 'peer.fullscreen.enterAria' })}
                title={intl.formatMessage({ id: 'peer.fullscreen.enter' })}
                onClick={onEnterFullscreen}
              >
                <Maximize2Icon />
                {intl.formatMessage({ id: 'peer.fullscreen.enter' })}
              </Button>
            )}
          </div>
        </div>
      )}
      {fullscreen && onExitFullscreen && (
        <RoomImmersiveCapsule
          onMore={onFullscreenMore}
          onExit={onExitFullscreen}
          exitAriaLabelId={exitAriaLabelId}
          exitTitleId={exitTitleId}
        />
      )}
      {showMotionPermission && (
        <Button
          type="button"
          size="sm"
          className="absolute top-3 right-3 z-50 rounded-full shadow-lg"
          onClick={() => {
            // Keep this call synchronous: iOS consumes transient activation immediately.
            bridgeRef.current?.requestOrientationPermission();
            setShowMotionPermission(false);
          }}
        >
          {intl.formatMessage({ id: 'room.motion.enable', defaultMessage: 'Enable motion controls' })}
        </Button>
      )}
      {viewport ? (
        <div
          className={cn(
            'relative w-full overflow-hidden bg-white',
            viewport.fill ? 'min-h-0 flex-1' : 'shrink-0',
          )}
          style={viewport.aspectRatio ? { aspectRatio: viewport.aspectRatio } : undefined}
        >
          {loadError ? <div className="absolute inset-0 flex items-center justify-center p-6 text-sm text-destructive">{loadError}</div> : null}
          {frameUrl ? (
            <iframe
              ref={ref}
              src={frameUrl}
              allow="accelerometer; gyroscope; magnetometer"
              title={label}
              className="absolute inset-0 h-full w-full border-0 bg-white"
            />
          ) : null}
        </div>
      ) : (
        <>
          {loadError ? <div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">{loadError}</div> : null}
          {frameUrl ? <iframe ref={ref} src={frameUrl} title={label} className="w-full flex-1 border-0 bg-white" allow="accelerometer; gyroscope; magnetometer" /> : null}
        </>
      )}
    </div>
  );
}
