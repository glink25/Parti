import { useEffect, useId, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { navigateToPeerJoin, parseInviteInput } from '../lib/peerRoutes.js';

type ScannerLike = {
  getState: () => number;
  stop: () => Promise<null | void>;
};

async function stopScannerIfRunning(
  scanner: ScannerLike,
  states: { SCANNING: number; PAUSED: number },
): Promise<void> {
  try {
    const state = scanner.getState();
    if (state !== states.SCANNING && state !== states.PAUSED) return;
    await scanner.stop();
  } catch {
    // 已停止或从未成功启动。
  }
}

export default function JoinRoomQrScanner({ onSuccess }: { onSuccess?: () => void }) {
  const intl = useIntl();
  const elementId = useId().replace(/:/g, '');
  const scannerRef = useRef<ScannerLike | null>(null);
  const handledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    handledRef.current = false;

    async function start(): Promise<void> {
      try {
        const { Html5Qrcode, Html5QrcodeScannerState } = await import('html5-qrcode');
        if (cancelled) return;

        const scanner = new Html5Qrcode(elementId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (handledRef.current || cancelled) return;
            const route = parseInviteInput(decodedText);
            if (!route) return;

            handledRef.current = true;
            void (async () => {
              await stopScannerIfRunning(scanner, Html5QrcodeScannerState);
              scannerRef.current = null;
              if (cancelled) return;
              onSuccess?.();
              navigateToPeerJoin(route);
            })();
          },
          () => {},
        );

        if (cancelled) {
          await stopScannerIfRunning(scanner, Html5QrcodeScannerState);
          scannerRef.current = null;
        }
      } catch (reason) {
        scannerRef.current = null;
        if (cancelled) return;
        const message = reason instanceof Error && /denied|permission/i.test(reason.message)
          ? intl.formatMessage({ id: 'lobby.join.cameraDenied' })
          : intl.formatMessage({ id: 'lobby.join.scanFailed' });
        setError(message);
      }
    }

    void start();

    return () => {
      cancelled = true;
      const active = scannerRef.current;
      scannerRef.current = null;
      if (!active) return;
      void import('html5-qrcode').then(({ Html5QrcodeScannerState }) =>
        stopScannerIfRunning(active, Html5QrcodeScannerState),
      );
    };
  }, [elementId, intl, onSuccess]);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-center text-sm text-danger">{error}</p>
      ) : (
        <div id={elementId} className="overflow-hidden rounded-xl [&_video]:rounded-xl" />
      )}
    </div>
  );
}
