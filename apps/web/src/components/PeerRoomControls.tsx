import { useEffect, useState } from 'react';
import { ActivityIcon, BotIcon, CircleIcon, CopyIcon, QrCodeIcon, RefreshCwIcon, WandSparklesIcon } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { RoomAdmissionStatus } from '@parti/core';
import type { HostRoomSettings } from '@/lib/roomSettings';
import type { LobbyStatusKey } from '@/lib/lobbyApi';
import { generateRoomPassword } from '@/lib/roomSettings';
import { formatLobbyStatus } from '@/i18n/formatErrors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { InviteJoinHelpDialog } from '@/components/InviteJoinHelpDialog';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';
import { buildAgentPrompt } from '@/lib/agentPrompt';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ENABLE_REPLAYS } from '@/lib/featureFlags';
import type { TransportConfig } from '@/lib/transportConfig';
import type { SensorPermissionControl } from '@/components/RoomFrame';

export type RoomControlsProps = {
  settings: HostRoomSettings;
  passwordDraft: string;
  admission: RoomAdmissionStatus;
  lobbyStatus: LobbyStatusKey;
  lobbyError: string | null;
  visibilityMode: 'online' | 'lan';
  inviteUrl: string;
  agentInviteUrl: string;
  copied: boolean;
  transportConfig: TransportConfig;
  onCopyInvite: () => void;
  onOpenQr: () => void;
  onPasswordDraftChange: (value: string) => void;
  onApplySettings: (settings: HostRoomSettings) => void;
  onTogglePublic: () => void;
  publicToggleBusy: boolean;
  replayBusy: boolean;
  replayError: string | null;
  onToggleReplay: () => void;
  sensorPermission?: SensorPermissionControl | null;
};

function SensorPermissionCard({ control }: { control: SensorPermissionControl }) {
  const canRequest = control.status === 'needs-permission';
  const enabled = control.status === 'active' || control.status === 'no-data';
  return (
    <Card className="gap-3 rounded-[18px] border-border bg-[linear-gradient(150deg,var(--surface-2),var(--surface))]">
      <CardHeader>
        <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">
          <FormattedMessage id="peer.sensors.eyebrow" />
        </span>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ActivityIcon className="size-4" />
          <FormattedMessage id="peer.sensors.title" />
        </CardTitle>
        <CardDescription><FormattedMessage id={`peer.sensors.status.${control.status}`} /></CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant={enabled ? 'outline' : 'default'}
          disabled={!canRequest}
          onClick={control.requestPermission}
        >
          <FormattedMessage id={enabled ? 'peer.sensors.enabled' : control.status === 'requesting' ? 'peer.sensors.requesting' : 'peer.sensors.enable'} />
        </Button>
      </CardContent>
    </Card>
  );
}

function InviteCard({ props, showAdmissionStatus = true }: { props: RoomControlsProps; showAdmissionStatus?: boolean }) {
  const { settings, admission, inviteUrl, agentInviteUrl, copied, transportConfig, onCopyInvite, onOpenQr } = props;
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);

  async function copyAgentPrompt(): Promise<void> {
    const roomTitle = settings.title.trim() || inviteUrl;
    const prompt = buildAgentPrompt({ agentUrl: agentInviteUrl, roomTitle });
    const ok = await copyTextToClipboard(prompt);
    if (!ok) return;
    setAiCopied(true);
    window.setTimeout(() => setAiCopied(false), 1800);
  }

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
        <div className="mt-2.5">
          <Button type="button" variant="outline" className="w-full" onClick={() => void copyAgentPrompt()}>
            <BotIcon data-icon="inline-start" />
            <FormattedMessage id={aiCopied ? 'peer.invite.inviteAiCopied' : 'peer.invite.inviteAi'} />
          </Button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <FormattedMessage id="peer.invite.inviteAiHint" />
          </p>
        </div>
        <div className='flex justify-between items-center'>
          {showAdmissionStatus && (
            <div className="mt-3 flex items-center gap-[7px] text-[10px] text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', admission.joinable ? 'bg-success' : 'bg-danger')} />
              <FormattedMessage id={admission.joinable ? 'peer.invite.joinable' : 'peer.invite.full'} />
            </div>
          )}
          <button
            type="button"
            className="mt-2 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setHelpOpen(true)}
          >
            <FormattedMessage id="peer.invite.joinHelpLink" />
          </button>
        </div>
        <InviteJoinHelpDialog open={helpOpen} onOpenChange={setHelpOpen} transportConfig={transportConfig} />
      </CardContent>
    </Card>
  );
}

function RefreshRoomControl() {
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>
        <RefreshCwIcon data-icon="inline-start" />
        <FormattedMessage id="peer.settings.refresh" />
      </Button>
      <span className="text-[10px] text-muted-foreground">
        <FormattedMessage id="peer.settings.refreshHint" />
      </span>
    </div>
  );
}

function RefreshRoomCard() {
  return (
    <Card className="gap-3 rounded-[18px] border-border bg-[linear-gradient(150deg,var(--surface-2),var(--surface))]">
      <CardHeader>
        <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">
          <FormattedMessage id="peer.settings.eyebrow" />
        </span>
        <CardTitle className="text-lg"><FormattedMessage id="peer.settings.refresh" /></CardTitle>
      </CardHeader>
      <CardContent>
        <RefreshRoomControl />
      </CardContent>
    </Card>
  );
}

function SettingsCard({ props }: { props: RoomControlsProps }) {
  const intl = useIntl();
  const { settings, passwordDraft, lobbyStatus, lobbyError, visibilityMode, publicToggleBusy, replayBusy, replayError, onPasswordDraftChange, onApplySettings, onTogglePublic, onToggleReplay } = props;
  const isLan = visibilityMode === 'lan';
  const [titleDraft, setTitleDraft] = useState(settings.title);
  useEffect(() => { setTitleDraft(settings.title); }, [settings.title]);

  function commitTitleDraft(): void {
    if (titleDraft !== settings.title) onApplySettings({ ...settings, title: titleDraft });
  }

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
          <FormattedMessage id={isLan
            ? settings.isPublic ? 'peer.settings.lanVisible' : 'peer.settings.lanHidden'
            : settings.isPublic ? 'peer.settings.public' : 'peer.settings.private'} />
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label className="flex flex-col items-stretch gap-2 text-muted-foreground">
          <FormattedMessage id="peer.settings.roomTitle" />
          <Input
            value={titleDraft}
            maxLength={80}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitleDraft}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          />
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
          <Button type="button" variant={settings.isPublic ? 'outline' : 'default'} disabled={publicToggleBusy} onClick={onTogglePublic}>
            <FormattedMessage id={isLan
              ? settings.isPublic ? 'peer.settings.hideFromLan' : 'peer.settings.showOnLan'
              : settings.isPublic ? 'peer.settings.makePrivate' : 'peer.settings.makePublic'} />
          </Button>
        </div>
        {ENABLE_REPLAYS && <div className="rounded-xl border border-border bg-background/55 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground"><FormattedMessage id="peer.settings.replayTitle" /></div>
              <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground"><FormattedMessage id="peer.settings.replayDescription" /></div>
            </div>
            <Button type="button" variant={settings.replayEnabled ? 'default' : 'outline'} disabled={replayBusy} onClick={onToggleReplay}>
              <CircleIcon className={settings.replayEnabled ? 'fill-current' : ''} data-icon="inline-start" />
              <FormattedMessage id={replayBusy ? 'peer.settings.replayLoading' : settings.replayEnabled ? 'peer.settings.replayOn' : 'peer.settings.replayOff'} />
            </Button>
          </div>
          {replayError && <div className="mt-2 text-[10px] text-destructive">{replayError}</div>}
        </div>}
        <span className="text-[10px] text-muted-foreground">
          {isLan
            ? intl.formatMessage({ id: settings.isPublic ? 'peer.settings.lanVisibleHint' : 'peer.settings.lanHiddenHint' })
            : formatLobbyStatus(intl, lobbyStatus)}
          {lobbyError ? ` · ${lobbyError}` : ''}
        </span>
        <RefreshRoomControl />
      </CardContent>
    </Card>
  );
}

function ControlsContent({ props, showSettings = true, showAdmissionStatus = true }: { props: RoomControlsProps; showSettings?: boolean; showAdmissionStatus?: boolean }) {
  return (
    <>
      <InviteCard props={props} showAdmissionStatus={showAdmissionStatus} />
      {props.sensorPermission && <SensorPermissionCard control={props.sensorPermission} />}
      {showSettings ? <SettingsCard props={props} /> : <RefreshRoomCard />}
    </>
  );
}

export function ResponsiveRoomControls({ open, onOpenChange, props, showSettings = true }: { open: boolean; onOpenChange: (open: boolean) => void; props: RoomControlsProps; showSettings?: boolean }) {
  const mobile = useMediaQuery('(max-width: 767px)');
  if (!mobile) return <aside className="flex flex-col gap-3.5 max-lg:grid max-lg:grid-cols-2"><ControlsContent props={props} showSettings={showSettings} /></aside>;
  return <RoomControlsSheet open={open} onOpenChange={onOpenChange} props={props} showSettings={showSettings} />;
}

export function RoomControlsSheet({
  open,
  onOpenChange,
  props,
  showSettings = true,
  showAdmissionStatus = true,
  sheetTitleId = 'peer.settings.sheetTitle',
  sheetDescriptionId = 'peer.settings.sheetDescription',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  props: RoomControlsProps;
  showSettings?: boolean;
  showAdmissionStatus?: boolean;
  sheetTitleId?: string;
  sheetDescriptionId?: string;
}) {
  if (!open) return null;
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent autoFocus={false} side="bottom" className="max-h-[88dvh] overflow-hidden rounded-t-3xl border-border bg-popover px-0 pb-[env(safe-area-inset-bottom)]">
        <SheetHeader className="shrink-0 border-b px-5 py-4 text-left">
          <SheetTitle><FormattedMessage id={sheetTitleId} /></SheetTitle>
          <SheetDescription><FormattedMessage id={sheetDescriptionId} /></SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          <div className={cn('grid gap-3', showSettings && 'sm:grid-cols-2')}>
            <ControlsContent props={props} showSettings={showSettings} showAdmissionStatus={showAdmissionStatus} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
