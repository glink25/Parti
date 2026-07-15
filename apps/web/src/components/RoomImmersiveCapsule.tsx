import { useIntl } from 'react-intl';
import { MoreHorizontalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function ExitImmersiveIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('size-[18px]', className)}
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="3.25" fill="currentColor" />
    </svg>
  );
}

/** Corner inset matching CornerSnapShell default (margin 16 + safe-area). */
export const ROOM_IMMERSIVE_CAPSULE_CORNER_CLASS =
  'absolute top-[calc(16px+env(safe-area-inset-top))] right-[calc(16px+env(safe-area-inset-right))]';

export function RoomImmersiveCapsule({
  onMore,
  onExit,
  className,
  exitAriaLabelId = 'peer.fullscreen.exitAria',
  exitTitleId = 'peer.fullscreen.exitTitle',
}: {
  onMore?: () => void;
  onExit: () => void;
  className?: string;
  exitAriaLabelId?: string;
  exitTitleId?: string;
}) {
  const intl = useIntl();
  const buttonClass =
    'flex size-8 items-center justify-center text-white/90 transition-colors hover:text-white active:text-white/70';

  return (
    <div
      className={cn(
        'flex items-center overflow-hidden rounded-full border border-white/15 bg-black/45 shadow-[0_4px_8px_rgba(0,0,0,0.15)] backdrop-blur-md',
        className,
      )}
    >
      {onMore && (
        <>
          <button
            type="button"
            className={buttonClass}
            aria-label={intl.formatMessage({ id: 'peer.fullscreen.settingsAria' })}
            title={intl.formatMessage({ id: 'peer.fullscreen.settingsAria' })}
            onClick={onMore}
          >
            <MoreHorizontalIcon className="size-[18px]" />
          </button>
          <span aria-hidden="true" className="h-4 w-px bg-white/20" />
        </>
      )}
      <button
        type="button"
        className={buttonClass}
        aria-label={intl.formatMessage({ id: exitAriaLabelId })}
        title={intl.formatMessage({ id: exitTitleId })}
        onClick={onExit}
      >
        <ExitImmersiveIcon />
      </button>
    </div>
  );
}
