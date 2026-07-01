import { CopyIcon, QrCodeIcon, WandSparklesIcon } from 'lucide-react';
import type { RoomAdmissionStatus } from '@parti/core';
import type { HostRoomSettings } from '@/lib/roomSettings.js';
import { generateRoomPassword } from '@/lib/roomSettings.js';
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
  lobbyStatus: string;
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
        <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">邀请朋友</span>
        <CardTitle className="text-lg">一起加入房间</CardTitle>
        <CardDescription>{settings.password ? '链接中已包含房间密码，可以直接分享。' : '复制链接，邀请朋友现在加入。'}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-[7px]">
          <Input className="min-w-0 flex-1" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
          <div className="flex shrink-0 gap-[7px]">
            <Button type="button" onClick={onCopyInvite}><CopyIcon data-icon="inline-start" />{copied ? '已复制' : '复制'}</Button>
            <Button type="button" variant="outline" onClick={onOpenQr}><QrCodeIcon data-icon="inline-start" />二维码</Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-[7px] text-[10px] text-muted-foreground"><span className={cn('size-1.5 rounded-full', admission.joinable ? 'bg-success' : 'bg-danger')} />{admission.joinable ? '当前可加入' : '房间人数已满'}</div>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ props }: { props: RoomControlsProps }) {
  const { settings, passwordDraft, lobbyStatus, onPasswordDraftChange, onApplySettings, onTogglePublic } = props;
  return (
    <Card className="gap-4 rounded-[18px] border-border bg-[linear-gradient(150deg,var(--surface-2),var(--surface))]">
      <CardHeader className="flex items-start justify-between gap-3">
        <div><span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">房间设置</span><CardTitle className="mt-1 text-lg">管理房间</CardTitle></div>
        <Badge variant={settings.isPublic ? 'default' : 'secondary'}>{settings.isPublic ? '公开' : '私密'}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label className="flex flex-col items-stretch gap-2 text-muted-foreground">房间标题<Input value={settings.title} maxLength={80} onChange={(event) => onApplySettings({ ...settings, title: event.target.value })} /></Label>
        <Label className="flex flex-col items-stretch gap-2 text-muted-foreground">
          4 位密码（留空为无密码）
          <div className="flex gap-[7px]">
            <Input className="min-w-0 flex-1" value={passwordDraft} inputMode="numeric" maxLength={4} onChange={(event) => onPasswordDraftChange(event.target.value.replace(/\D/g, '').slice(0, 4))} onBlur={() => { if (passwordDraft !== '' && !/^\d{4}$/.test(passwordDraft)) onPasswordDraftChange(settings.password); }} />
            <Button type="button" variant="outline" onClick={() => onPasswordDraftChange(generateRoomPassword())}><WandSparklesIcon data-icon="inline-start" />生成</Button>
          </div>
        </Label>
        <div><Button type="button" variant={settings.isPublic ? 'outline' : 'default'} onClick={onTogglePublic}>{settings.isPublic ? '设为私密' : '公开到大厅'}</Button></div>
        <span className="text-[10px] text-muted-foreground">{lobbyStatus}</span>
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
        <SheetHeader className="border-b px-5 py-4 text-left"><SheetTitle>房间设置</SheetTitle><SheetDescription>邀请朋友加入，或调整标题、密码和公开状态。</SheetDescription></SheetHeader>
        <div className="grid gap-3 overflow-y-auto px-4 pb-5 sm:grid-cols-2"><ControlsContent props={props} /></div>
      </SheetContent>
    </Sheet>
  );
}
