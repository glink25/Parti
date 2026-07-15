import { useIntl } from 'react-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TransportConfig } from '@/lib/transportConfig';

export function InviteJoinHelpDialog({
  open,
  onOpenChange,
  transportConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transportConfig: TransportConfig;
}) {
  const intl = useIntl();
  const isPeerjs = transportConfig.adapter === 'peerjs';
  const isLan = transportConfig.adapter === 'lan';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: 'peer.invite.joinHelpTitle' })}</DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({ id: 'peer.invite.joinHelpCurrentLabel' })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-background/55 p-3">
            <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {intl.formatMessage({ id: 'peer.invite.joinHelpCurrentLabel' })}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {intl.formatMessage({
                id: isLan ? 'peer.invite.joinHelpCurrentLan' : isPeerjs ? 'peer.invite.joinHelpCurrentPeerjs' : 'peer.invite.joinHelpCurrentSupabase',
              })}
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {intl.formatMessage({
              id: isLan ? 'peer.invite.joinHelpBodyLan' : isPeerjs ? 'peer.invite.joinHelpBodyPeerjs' : 'peer.invite.joinHelpBodySupabase',
            })}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {intl.formatMessage({ id: 'peer.invite.joinHelpSuggestion' })}
          </p>
        </div>
        <DialogFooter className="mx-0 mb-0 px-0 pb-0">
          <Button type="button" onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: 'peer.invite.joinHelpClose' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
