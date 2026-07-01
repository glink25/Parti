import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { ScanQrCodeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.js';

const JoinRoomQrScanner = lazy(() => import('./JoinRoomQrScanner.js'));

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
  const [open, setOpen] = useState(false);
  const [boundaryKey, setBoundaryKey] = useState(0);

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (next) setBoundaryKey((key) => key + 1);
  }

  const scanFailedMessage = intl.formatMessage({ id: 'lobby.join.scanFailed' });

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
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" className="rounded-t-[22px]">
          <SheetHeader>
            <SheetTitle>{intl.formatMessage({ id: 'lobby.join.scanSheetTitle' })}</SheetTitle>
            <SheetDescription>
              {intl.formatMessage({ id: 'lobby.join.scanSheetDescription' })}
            </SheetDescription>
          </SheetHeader>
          {open ? (
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
                <JoinRoomQrScanner onSuccess={() => setOpen(false)} />
              </QrScannerErrorBoundary>
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
