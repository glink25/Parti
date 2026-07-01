import { useIntl } from 'react-intl';
import { MoreHorizontalIcon } from 'lucide-react';
import { cn } from '@/lib/utils.js';

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

export function RoomImmersiveCapsule({
  onMore,
  onExit,
  className,
}: {
  onMore?: () => void;
  onExit: () => void;
  className?: string;
}) {
  const intl = useIntl();
  const buttonClass =
    'flex size-8 items-center justify-center text-white/90 transition-colors hover:text-white active:text-white/70';

  return (
    <div
      className={cn(
        'absolute z-10 flex items-center overflow-hidden rounded-full border border-white/15 bg-black/45 shadow-[0_4px_8px_rgba(0,0,0,0.15)] backdrop-blur-md',
        'top-[calc(16px+env(safe-area-inset-top))] right-[calc(16px+env(safe-area-inset-right))]',
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
        aria-label={intl.formatMessage({ id: 'peer.fullscreen.exitAria' })}
        title={intl.formatMessage({ id: 'peer.fullscreen.exitTitle' })}
        onClick={onExit}
      >
        <ExitImmersiveIcon />
      </button>
    </div>
  );
}
