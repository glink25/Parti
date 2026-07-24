import { useEffect, useState } from 'react';
import { BotIcon } from 'lucide-react';
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

export function InviteAiWarningDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (dontShowAgain: boolean) => void;
}) {
  const intl = useIntl();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // 每次重新打开都重置勾选状态。
  useEffect(() => { if (open) setDontShowAgain(false); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BotIcon className="size-4" />
            {intl.formatMessage({ id: 'peer.invite.inviteAiWarnTitle' })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({ id: 'peer.invite.inviteAiWarnBodyAgent' })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5 text-sm leading-relaxed text-muted-foreground">
          <p>{intl.formatMessage({ id: 'peer.invite.inviteAiWarnBodyAgent' })}</p>
          <p>{intl.formatMessage({ id: 'peer.invite.inviteAiWarnBodyBrowser' })}</p>
          <p>{intl.formatMessage({ id: 'peer.invite.inviteAiWarnBodyCost' })}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 shrink-0 rounded border-border accent-primary"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
          />
          {intl.formatMessage({ id: 'peer.invite.inviteAiWarnDontShow' })}
        </label>
        <DialogFooter className="mx-0 mb-0 px-0 pb-0">
          <Button type="button" onClick={() => onConfirm(dontShowAgain)}>
            {intl.formatMessage({ id: 'peer.invite.inviteAiWarnConfirm' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
