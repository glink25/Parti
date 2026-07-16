import { useState } from 'react';
import { useIntl } from 'react-intl';
import { CircleCheckIcon, GaugeIcon, NetworkIcon, UserRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { LOCALE_LABELS, LOCALES, type AppLocale } from '@/i18n/locales';
import { useLocale } from '@/i18n/LocaleProvider';
import { formatUserNameError } from '@/i18n/formatErrors';
import { TransportProfilesDialog } from './TransportProfilesDialog';
import { clearAllBrowserStorage } from '../lib/clearLocalData';
import {
  MAX_USER_NAME_LENGTH,
  saveLocalUserName,
  UserNameValidationError,
  type LocalUser,
} from '../lib/localUser';
import {
  getSelectedTransportProfile,
  getTransportProfiles,
  selectTransportProfile,
  type TransportConfig,
} from '../lib/transportConfig';

const sectionCardClass =
  'gap-4 rounded-[18px] border-border bg-[linear-gradient(150deg,var(--surface-2),var(--surface))] flex-shrink-0';

function transportMessageSuffix(config: TransportConfig): 'peerjs' | 'lan' | 'supabase' {
  if (config.adapter === 'peerjs') return 'peerjs';
  if (config.adapter === 'lan') return 'lan';
  return 'supabase';
}

export function UserSettings({ user, onChange }: { user: LocalUser; onChange: (user: LocalUser) => void }) {
  const intl = useIntl();
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(user.name);
  const [message, setMessage] = useState<string | null>(null);
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const profiles = getTransportProfiles();
  const selectedProfile = getSelectedTransportProfile();
  const transportSuffix = transportMessageSuffix(selectedProfile.config);

  function setSheetOpen(next: boolean): void {
    setOpen(next);
    if (next) {
      setDraft(user.name);
      setMessage(null);
    }
  }

  async function handleClearData(): Promise<void> {
    setClearing(true);
    try {
      await clearAllBrowserStorage();
      window.location.reload();
    } catch {
      setClearing(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-[150px] gap-2 px-2 text-muted-foreground hover:text-foreground sm:max-w-[210px] sm:px-2.5"
          aria-label={intl.formatMessage({ id: 'user.settings.ariaLabel' }, { name: user.name })}
        >
          <UserRoundIcon />
          <span className="hidden truncate sm:inline">{user.name}</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        className="w-full sm:max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{intl.formatMessage({ id: 'user.settings.sheetTitle' })}</SheetTitle>
          <SheetDescription>{intl.formatMessage({ id: 'user.settings.sheetDescription' })}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          <Card className={sectionCardClass}>
            <CardHeader>
              <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">
                {intl.formatMessage({ id: 'user.settings.profileEyebrow' })}
              </span>
              <CardTitle className="mt-1 text-lg">{intl.formatMessage({ id: 'user.settings.profileTitle' })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: 'user.settings.profileDescription' })}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    const next = saveLocalUserName(draft);
                    onChange(next);
                    setDraft(next.name);
                    setMessage(intl.formatMessage({ id: 'user.settings.saved' }));
                  } catch (error) {
                    if (error instanceof UserNameValidationError) {
                      setMessage(formatUserNameError(intl, error));
                    } else {
                      setMessage(error instanceof Error ? error.message : String(error));
                    }
                  }
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="parti-user-name">{intl.formatMessage({ id: 'user.settings.nameLabel' })}</Label>
                  <Input
                    id="parti-user-name"
                    value={draft}
                    maxLength={MAX_USER_NAME_LENGTH}
                    autoComplete="nickname"
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: 'user.settings.nameHint' })}</p>
                </div>
                <div className="grid gap-3">
                  {message && (
                    <p className="text-sm text-muted-foreground" role="status">
                      {message}
                    </p>
                  )}
                  <Button type="submit">{intl.formatMessage({ id: 'user.settings.save' })}</Button>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground/70">
                  {intl.formatMessage({ id: 'user.settings.idInline' }, { id: user.id })}
                </p>
              </form>
            </CardContent>
          </Card>

          <Card className={sectionCardClass}>
            <CardHeader>
              <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">
                {intl.formatMessage({ id: 'user.settings.transportEyebrow' })}
              </span>
              <CardTitle className="mt-1 text-lg">{intl.formatMessage({ id: 'user.settings.transportTitle' })}</CardTitle>
              <CardDescription>{intl.formatMessage({ id: 'user.settings.transportDescription' })}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Label htmlFor="parti-user-transport">{intl.formatMessage({ id: 'user.settings.transportLabel' })}</Label>
              <Select value={selectedProfile.id} onValueChange={(value) => {
                selectTransportProfile(value);
                setProfilesVersion((current) => current + 1);
              }}>
                <SelectTrigger id="parti-user-transport" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => {
                    const suffix = transportMessageSuffix(profile.config);
                    const friendlyLabel = intl.formatMessage({ id: `user.settings.transport.${suffix}.optionLabel` });
                    return (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.custom
                          ? intl.formatMessage(
                            { id: 'user.settings.transport.customOption' },
                            { label: friendlyLabel, name: profile.name },
                          )
                          : friendlyLabel}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <div className="min-w-0 rounded-xl border border-border bg-background/55 p-3.5" aria-live="polite">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {intl.formatMessage({ id: `user.settings.transport.${transportSuffix}.title` })}
                  </span>
                  {transportSuffix === 'peerjs' && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary-bright uppercase">
                      {intl.formatMessage({ id: 'user.settings.transport.recommended' })}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {intl.formatMessage({ id: `user.settings.transport.${transportSuffix}.technology` })}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {intl.formatMessage({ id: `user.settings.transport.${transportSuffix}.summary` })}
                </p>
                <ul className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex gap-2">
                    <NetworkIcon className="mt-0.5 size-3.5 shrink-0 text-primary-bright" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: `user.settings.transport.${transportSuffix}.network` })}</span>
                  </li>
                  <li className="flex gap-2">
                    <GaugeIcon className="mt-0.5 size-3.5 shrink-0 text-primary-bright" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: `user.settings.transport.${transportSuffix}.latency` })}</span>
                  </li>
                  <li className="flex gap-2">
                    <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary-bright" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: `user.settings.transport.${transportSuffix}.reliability` })}</span>
                  </li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: 'user.settings.transportHint' })}</p>
              <Button type="button" variant="outline" onClick={() => setProfilesOpen(true)}>
                {intl.formatMessage({ id: 'user.settings.profilesButton' })}
              </Button>
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: 'user.settings.profilesHint' })}</p>
            </CardContent>
          </Card>

          <Card className={sectionCardClass}>
            <CardHeader>
              <span className="text-[9px] font-extrabold tracking-[0.14em] text-primary-bright uppercase">
                {intl.formatMessage({ id: 'user.settings.languageEyebrow' })}
              </span>
              <CardTitle className="mt-1 text-lg">{intl.formatMessage({ id: 'user.settings.languageTitle' })}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Label htmlFor="parti-user-locale">{intl.formatMessage({ id: 'user.settings.languageLabel' })}</Label>
              <Select value={locale} onValueChange={(value) => setLocale(value as AppLocale)}>
                <SelectTrigger id="parti-user-locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {LOCALE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: 'user.settings.languageHint' })}</p>
            </CardContent>
          </Card>

          <div className="border-t border-border pt-4">
            <Button type="button" variant="destructive" className="w-full" onClick={() => setClearDataOpen(true)}>
              {intl.formatMessage({ id: 'user.settings.clearData' })}
            </Button>
          </div>
        </div>
      </SheetContent>
      <TransportProfilesDialog
        key={profilesVersion}
        open={profilesOpen}
        onOpenChange={setProfilesOpen}
        onProfilesChange={() => setProfilesVersion((current) => current + 1)}
      />
      <Dialog open={clearDataOpen} onOpenChange={setClearDataOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: 'user.settings.clearDataTitle' })}</DialogTitle>
            <DialogDescription>{intl.formatMessage({ id: 'user.settings.clearDataDescription' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDataOpen(false)} disabled={clearing}>
              {intl.formatMessage({ id: 'user.settings.clearDataCancel' })}
            </Button>
            <Button variant="destructive" onClick={() => void handleClearData()} disabled={clearing}>
              {intl.formatMessage({ id: 'user.settings.clearDataConfirm' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
