import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { CheckIcon, DatabaseIcon, NetworkIcon, Share2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getSelectedTransportProfile,
  getTransportProfiles,
  selectTransportProfile,
  TRANSPORT_PROFILES_CHANGED_EVENT,
  type TransportConfig,
  type TransportProfile,
} from '@/lib/transportConfig';

type TransportKind = 'peerjs' | 'lan' | 'supabase';

function transportKind(config: TransportConfig): TransportKind {
  if (config.adapter === 'peerjs') return 'peerjs';
  if (config.adapter === 'lan') return 'lan';
  return 'supabase';
}

const transportIcons = {
  peerjs: Share2Icon,
  lan: NetworkIcon,
  supabase: DatabaseIcon,
} as const;

function loadTransportState(): { profiles: TransportProfile[]; selected: TransportProfile } {
  return {
    profiles: getTransportProfiles(),
    selected: getSelectedTransportProfile(),
  };
}

export function TransportIndicator() {
  const intl = useIntl();
  const [transportState, setTransportState] = useState(loadTransportState);

  useEffect(() => {
    const update = () => setTransportState(loadTransportState());
    window.addEventListener(TRANSPORT_PROFILES_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(TRANSPORT_PROFILES_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  const { profiles, selected } = transportState;
  const kind = transportKind(selected.config);
  const Icon = transportIcons[kind];
  const label = intl.formatMessage({ id: `user.settings.transport.${kind}.optionLabel` });
  const accessibleLabel = intl.formatMessage({ id: 'app.header.syncMethod' }, { method: label });

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={accessibleLabel}
          title={accessibleLabel}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <DropdownMenuPrimitive.RadioGroup
            value={selected.id}
            onValueChange={(value) => {
              selectTransportProfile(value);
              setTransportState(loadTransportState());
            }}
          >
            {profiles.map((profile) => {
              const profileKind = transportKind(profile.config);
              const ProfileIcon = transportIcons[profileKind];
              const friendlyLabel = intl.formatMessage({ id: `user.settings.transport.${profileKind}.optionLabel` });
              return (
                <DropdownMenuPrimitive.RadioItem
                  key={profile.id}
                  value={profile.id}
                  className="relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground"
                >
                  <ProfileIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {profile.custom
                      ? intl.formatMessage(
                        { id: 'user.settings.transport.customOption' },
                        { label: friendlyLabel, name: profile.name },
                      )
                      : friendlyLabel}
                  </span>
                  <DropdownMenuPrimitive.ItemIndicator className="absolute right-2 inline-flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" aria-hidden="true" />
                  </DropdownMenuPrimitive.ItemIndicator>
                </DropdownMenuPrimitive.RadioItem>
              );
            })}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
