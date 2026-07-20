import { useIntl } from 'react-intl';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SOLANA_WALLET_ADDRESS = 'vEzM9jmxChx2AoMMDpHARHZcUjmUCHdBShwF9eJYGEg';

type DonationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DonationDialog({ open, onOpenChange }: DonationDialogProps) {
  const intl = useIntl();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{intl.formatMessage({ id: 'user.settings.donationDialogTitle' })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: 'user.settings.donationDialogDescription' })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 overflow-y-auto pr-1 sm:grid-cols-2">
          <section className="grid content-start gap-3 rounded-2xl border border-border bg-background/55 p-4">
            <h3 className="font-semibold text-foreground">
              {intl.formatMessage({ id: 'user.settings.donationAlipayTitle' })}
            </h3>
            <img
              src="/donation/alipay.png"
              alt={intl.formatMessage({ id: 'user.settings.donationAlipayAlt' })}
              className="mx-auto aspect-square w-full max-w-64 rounded-xl object-contain"
            />
          </section>
          <section className="grid content-start gap-3 rounded-2xl border border-border bg-background/55 p-4">
            <h3 className="font-semibold text-foreground">
              {intl.formatMessage({ id: 'user.settings.donationSolanaTitle' })}
            </h3>
            <img
              src="/donation/solana.png"
              alt={intl.formatMessage({ id: 'user.settings.donationSolanaAlt' })}
              className="mx-auto aspect-square w-full max-w-64 rounded-xl object-contain"
            />
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: 'user.settings.donationWalletLabel' })}
              </span>
              <code className="select-all break-all rounded-lg bg-muted px-2.5 py-2 text-xs leading-relaxed text-foreground">
                {SOLANA_WALLET_ADDRESS}
              </code>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
