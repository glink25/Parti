import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  INVITE_QR_QUIET_ZONE,
  INVITE_QR_SIZE,
  selectInviteQrRenderProfile,
} from '@/lib/inviteQr';
import { cn } from '@/lib/utils';
import { LOGO_URL } from './Logo';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('iconLoadFailed'));
    image.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

async function drawInviteQr(canvas: HTMLCanvasElement, inviteUrl: string): Promise<void> {
  const { default: QRCode } = await import('qrcode');
  const highCorrectionQr = QRCode.create(inviteUrl, { errorCorrectionLevel: 'H' });
  const profile = selectInviteQrRenderProfile(highCorrectionQr.modules.size);
  await QRCode.toCanvas(canvas, inviteUrl, {
    width: INVITE_QR_SIZE,
    margin: INVITE_QR_QUIET_ZONE,
    errorCorrectionLevel: profile.errorCorrectionLevel,
    color: { dark: '#211f17', light: '#ffffff' },
  });

  if (!profile.showLogo) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  try {
    const logo = await loadImage(LOGO_URL);
    const logoSize = INVITE_QR_SIZE * 0.22;
    const pad = logoSize * 0.15;
    const bgSize = logoSize + pad * 2;
    const bgX = (INVITE_QR_SIZE - bgSize) / 2;
    const bgY = (INVITE_QR_SIZE - bgSize) / 2;

    ctx.fillStyle = '#ffffff';
    drawRoundedRect(ctx, bgX, bgY, bgSize, bgSize, 8);
    ctx.fill();

    ctx.drawImage(logo, bgX + pad, bgY + pad, logoSize, logoSize);
  } catch {
    // 图标加载失败时仍保留可扫描的二维码
  }
}

export function InviteQrDialog({
  open,
  onOpenChange,
  inviteUrl,
  inviterName,
  roomTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteUrl: string;
  inviterName: string;
  roomTitle: string;
}) {
  const intl = useIntl();
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setCanvasEl(null);
      setError(null);
      setLoading(false);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !canvasEl) return;

    let cancelled = false;
    setError(null);
    setLoading(true);

    void drawInviteQr(canvasEl, inviteUrl)
      .catch((reason) => {
        if (!cancelled) {
          const message = reason instanceof Error && reason.message === 'iconLoadFailed'
            ? intl.formatMessage({ id: 'peer.invite.iconLoadFailed' })
            : intl.formatMessage({ id: 'peer.invite.qrFailed' });
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, inviteUrl, canvasEl, intl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: 'peer.invite.qrTitle' })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div
            className={cn(
              'grid w-full max-w-[320px] place-items-center rounded-[14px] border border-border bg-white',
              loading && 'animate-pulse',
            )}
          >
            {error ? (
              <p className="px-4 text-center text-xs text-danger">{error}</p>
            ) : (
              <canvas
                ref={setCanvasEl}
                width={INVITE_QR_SIZE}
                height={INVITE_QR_SIZE}
                className="h-auto w-full"
              />
            )}
          </div>
          <p className="text-center text-sm wrap-break-word text-muted-foreground">
            {intl.formatMessage({ id: 'peer.invite.qrInvite' }, { inviterName, roomTitle })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
