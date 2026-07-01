import { CopyIcon, QrCodeIcon, WandSparklesIcon } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { RoomAdmissionStatus } from '@parti/core';
import type { HostRoomSettings } from '@/lib/roomSettings.js';
import type { LobbyStatusKey } from '@/lib/lobbyApi.js';
import { generateRoomPassword } from '@/lib/roomSettings.js';
import { formatLobbyStatus } from '@/i18n/formatErrors.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet.js';
import { cn } from '@/lib/utils.js';
import { useMediaQuery } from '@/hooks/useMediaQuery.js';

export type RoomControlsProps = {
  settings: HostRoomSettings;
  passwordDraft: string;
  admission: RoomAdmissionStatus;
  lobbyStatus: LobbyStatusKey;
  lobbyError: string | null;
  inviteUrl: string;
  copied: boolean;
  onCopyInvite: () => void;
  onOpenQr: () => void;
  onPasswordDraftChange: (value: string) => void;
  onApplySettings: (settings: HostRoomSettings) => void;
  onTogglePublic: () => void;
};

function InviteCard({ props }: { props: RoomControlsProps }) {
  const { settings, admission, inviteUrl, copied, onCopyInvite, onOpenQr } = props;
  return (
    <Card className="gap-3 rounded-[18px] border-border bg-[linear-gradient(150deg,var(--surface-2),var(--surface))]">
      <CardHeader>
        <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">
          <FormattedMessage id="peer.invite.eyebrow" />
        </span>
        <CardTitle className="text-lg"><FormattedMessage id="peer.invite.title" /></CardTitle>
        <CardDescription>
          <FormattedMessage id={settings.password ? 'peer.invite.withPassword' : 'peer.invite.withoutPassword'} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-[7px]">
          <Input className="min-w-0 flex-1" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
          <div className="flex shrink-0 gap-[7px]">
            <Button type="button" onClick={onCopyInvite}>
              <CopyIcon data-icon="inline-start" />
              <FormattedMessage id={copied ? 'peer.invite.copied' : 'peer.invite.copy'} />
            </Button>
            <Button type="button" variant="outline" onClick={onOpenQr}>
              <QrCodeIcon data-icon="inline-start" /><FormattedMessage id="peer.invite.qr" />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-[7px] text-[10px] text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', admission.joinable ? 'bg-success' : 'bg-danger')} />
          <FormattedMessage id={admission.joinable ? 'peer.invite.joinable' : 'peer.invite.full'} />
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ props }: { props: RoomControlsProps }) {
  const intl = useIntl();
  const { settings, passwordDraft, lobbyStatus, lobbyError, onPasswordDraftChange, onApplySettings, onTogglePublic } = props;
  return (
    <Card className="gap-4 rounded-[18px] border-border bg-[linear-gradient(150deg,var(--surface-2),var(--surface))]">
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">
            <FormattedMessage id="peer.settings.eyebrow" />
          </span>
          <CardTitle className="mt-1 text-lg"><FormattedMessage id="peer.settings.title" /></CardTitle>
        </div>
        <Badge variant={settings.isPublic ? 'default' : 'secondary'}>
          <FormattedMessage id={settings.isPublic ? 'peer.settings.public' : 'peer.settings.private'} />
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label className="flex flex-col items-stretch gap-2 text-muted-foreground">
          <FormattedMessage id="peer.settings.roomTitle" />
          <Input value={settings.title} maxLength={80} onChange={(event) => onApplySettings({ ...settings, title: event.target.value })} />
        </Label>
        <Label className="flex flex-col items-stretch gap-2 text-muted-foreground">
          <FormattedMessage id="peer.settings.passwordLabel" />
          <div className="flex gap-[7px]">
            <Input className="min-w-0 flex-1" value={passwordDraft} inputMode="numeric" maxLength={4} onChange={(event) => onPasswordDraftChange(event.target.value.replace(/\D/g, '').slice(0, 4))} onBlur={() => { if (passwordDraft !== '' && !/^\d{4}$/.test(passwordDraft)) onPasswordDraftChange(settings.password); }} />
            <Button type="button" variant="outline" onClick={() => onPasswordDraftChange(generateRoomPassword())}>
              <WandSparklesIcon data-icon="inline-start" /><FormattedMessage id="peer.settings.generate" />
            </Button>
          </div>
        </Label>
        <div>
          <Button type="button" variant={settings.isPublic ? 'outline' : 'default'} onClick={onTogglePublic}>
            <FormattedMessage id={settings.isPublic ? 'peer.settings.makePrivate' : 'peer.settings.makePublic'} />
          </Button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {formatLobbyStatus(intl, lobbyStatus)}
          {lobbyError ? ` · ${lobbyError}` : ''}
        </span>
      </CardContent>
    </Card>
  );
}

function ControlsContent({ props }: { props: RoomControlsProps }) {
  return <><InviteCard props={props} /><SettingsCard props={props} /></>;
}

export function ResponsiveRoomControls({ open, onOpenChange, props }: { open: boolean; onOpenChange: (open: boolean) => void; props: RoomControlsProps }) {
  const mobile = useMediaQuery('(max-width: 767px)');
  if (!mobile) return <aside className="flex flex-col gap-3.5 max-lg:grid max-lg:grid-cols-2"><ControlsContent props={props} /></aside>;
  return <RoomControlsSheet open={open} onOpenChange={onOpenChange} props={props} />;
}

export function RoomControlsSheet({ open, onOpenChange, props }: { open: boolean; onOpenChange: (open: boolean) => void; props: RoomControlsProps }) {
  if (!open) return null;
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] rounded-t-3xl border-border bg-popover px-0 pb-[env(safe-area-inset-bottom)]">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle><FormattedMessage id="peer.settings.sheetTitle" /></SheetTitle>
          <SheetDescription><FormattedMessage id="peer.settings.sheetDescription" /></SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 overflow-y-auto px-4 pb-5 sm:grid-cols-2"><ControlsContent props={props} /></div>
      </SheetContent>
    </Sheet>
  );
}
