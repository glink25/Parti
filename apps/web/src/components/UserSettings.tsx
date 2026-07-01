import { useState } from 'react';
import { useIntl } from 'react-intl';
import { UserRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet.js';
import { LOCALE_LABELS, LOCALES, type AppLocale } from '@/i18n/locales.js';
import { useLocale } from '@/i18n/LocaleProvider.js';
import { formatUserNameError } from '@/i18n/formatErrors.js';
import { TransportProfilesDialog } from './TransportProfilesDialog.js';
import {
  MAX_USER_NAME_LENGTH,
  saveLocalUserName,
  UserNameValidationError,
  type LocalUser,
} from '../lib/localUser.js';
import { getSelectedTransportProfile, getTransportProfiles, selectTransportProfile } from '../lib/transportConfig.js';

const sectionCardClass =
  'gap-4 rounded-[18px] border-border bg-[linear-gradient(150deg,var(--surface-2),var(--surface))] flex-shrink-0';

export function UserSettings({ user, onChange }: { user: LocalUser; onChange: (user: LocalUser) => void }) {
  const intl = useIntl();
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(user.name);
  const [message, setMessage] = useState<string | null>(null);
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const profiles = getTransportProfiles();
  const selectedProfile = getSelectedTransportProfile();

  function setSheetOpen(next: boolean): void {
    setOpen(next);
    if (next) {
      setDraft(user.name);
      setMessage(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className="ml-auto max-w-[210px] gap-2 px-2.5 text-muted-foreground hover:text-foreground"
          aria-label={intl.formatMessage({ id: 'user.settings.ariaLabel' }, { name: user.name })}
        >
          <UserRoundIcon />
          <span className="truncate sm:inline">{user.name}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
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
            <CardContent className="grid gap-2">
              <Label htmlFor="parti-user-transport">{intl.formatMessage({ id: 'user.settings.transportLabel' })}</Label>
              <Select value={selectedProfile.id} onValueChange={(value) => {
                selectTransportProfile(value);
                setProfilesVersion((current) => current + 1);
              }}>
                <SelectTrigger id="parti-user-transport" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: 'user.settings.transportHint' })}</p>
              <Button type="button" variant="outline" onClick={() => setProfilesOpen(true)}>
                {intl.formatMessage({ id: 'user.settings.profilesButton' })}
              </Button>
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
        </div>
      </SheetContent>
      <TransportProfilesDialog
        key={profilesVersion}
        open={profilesOpen}
        onOpenChange={setProfilesOpen}
        onProfilesChange={() => setProfilesVersion((current) => current + 1)}
      />
    </Sheet>
  );
}
