import { Component, lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { ScanQrCodeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const JoinRoomQrScanner = lazy(() => import('./JoinRoomQrScanner'));

class QrScannerErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function ScanJoinButton() {
  const intl = useIntl();
  const mobile = useMediaQuery('(max-width: 767px)');
  const [open, setOpen] = useState(false);
  const [boundaryKey, setBoundaryKey] = useState(0);

  const handleOpenChange = useCallback((next: boolean): void => {
    setOpen(next);
    if (next) setBoundaryKey((key) => key + 1);
  }, []);

  const handleSuccess = useCallback(() => setOpen(false), []);

  const scanFailedMessage = intl.formatMessage({ id: 'lobby.join.scanFailed' });
  const title = intl.formatMessage({ id: 'lobby.join.scanSheetTitle' });
  const description = intl.formatMessage({ id: 'lobby.join.scanSheetDescription' });

  const scannerBody = open ? (
    <Suspense
      fallback={
        <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
          …
        </div>
      }
    >
      <QrScannerErrorBoundary
        key={boundaryKey}
        fallback={
          <p className="py-8 text-center text-sm text-danger">{scanFailedMessage}</p>
        }
      >
        <JoinRoomQrScanner onSuccess={handleSuccess} />
      </QrScannerErrorBoundary>
    </Suspense>
  ) : null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-12 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
        aria-label={intl.formatMessage({ id: 'lobby.hero.scanJoinAria' })}
        onClick={() => handleOpenChange(true)}
      >
        <ScanQrCodeIcon className="size-5" />
      </Button>
      {mobile ? (
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-[22px]">
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            {scannerBody}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {scannerBody}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
