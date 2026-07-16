import { lazy, Suspense, useState } from 'react';
import { useIntl } from 'react-intl';
import { UserRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LocalUser } from '../lib/localUser';

const UserSettingsPanel = lazy(() =>
  import('./UserSettingsPanel').then((module) => ({ default: module.UserSettingsPanel })),
);

type UserSettingsProps = {
  user: LocalUser;
  onChange: (user: LocalUser) => void;
};

export function UserSettings({ user, onChange }: UserSettingsProps) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  function openSettings(): void {
    setLoaded(true);
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="ghost"
        className="max-w-[150px] gap-2 px-2 text-muted-foreground hover:text-foreground sm:max-w-[210px] sm:px-2.5"
        aria-label={intl.formatMessage({ id: 'user.settings.ariaLabel' }, { name: user.name })}
        onClick={openSettings}
      >
        <UserRoundIcon />
        <span className="hidden truncate sm:inline">{user.name}</span>
      </Button>
      {loaded && (
        <Suspense fallback={null}>
          <UserSettingsPanel open={open} onOpenChange={setOpen} user={user} onChange={onChange} />
        </Suspense>
      )}
    </>
  );
}
