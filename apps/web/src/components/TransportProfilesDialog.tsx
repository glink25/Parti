import { useState } from 'react';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  deleteCustomTransportProfile, getTransportProfiles, saveCustomTransportProfile,
  type TransportConfig, type TransportProfile,
} from '@/lib/transportConfig';

type FormType = 'peerjs' | 'supabase';
interface Draft { id?: string; name: string; type: FormType; serverUrl: string; supabaseUrl: string; publishableKey: string }

function emptyDraft(): Draft {
  return { name: '', type: 'peerjs', serverUrl: '', supabaseUrl: '', publishableKey: '' };
}

function draftFor(profile: TransportProfile): Draft {
  return profile.config.adapter === 'peerjs'
    ? { id: profile.id, name: profile.name, type: 'peerjs', serverUrl: profile.config.serverUrl ?? '', supabaseUrl: '', publishableKey: '' }
    : { id: profile.id, name: profile.name, type: 'supabase', serverUrl: '', supabaseUrl: profile.config.url, publishableKey: profile.config.publishableKey };
}

export function TransportProfilesDialog({ open, onOpenChange, onProfilesChange }: {
  open: boolean; onOpenChange(open: boolean): void; onProfilesChange(): void;
}) {
  const intl = useIntl();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profiles = getTransportProfiles();

  function close(next: boolean): void {
    onOpenChange(next);
    if (!next) { setDraft(null); setError(null); }
  }

  function save(): void {
    if (!draft) return;
    try {
      const config: TransportConfig = draft.type === 'peerjs'
        ? { adapter: 'peerjs', ...(draft.serverUrl.trim() ? { serverUrl: draft.serverUrl.trim() } : {}) }
        : { adapter: 'common', provider: 'supabase', url: draft.supabaseUrl.trim(), publishableKey: draft.publishableKey.trim() };
      saveCustomTransportProfile({ name: draft.name, config }, draft.id);
      setDraft(null);
      setError(null);
      onProfilesChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: 'user.settings.profilesTitle' })}</DialogTitle>
          <DialogDescription>{intl.formatMessage({ id: 'user.settings.profilesDescription' })}</DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="grid gap-3">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{profile.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {profile.config.adapter === 'peerjs' ? 'PeerJS' : 'Supabase Realtime'}
                    {!profile.custom && ` · ${intl.formatMessage({ id: 'user.settings.profilesBuiltIn' })}`}
                  </div>
                </div>
                {profile.custom && (
                  <>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={intl.formatMessage({ id: 'user.settings.profilesEdit' })} onClick={() => { setDraft(draftFor(profile)); setError(null); }}>
                      <PencilIcon />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={intl.formatMessage({ id: 'user.settings.profilesDelete' })} onClick={() => { deleteCustomTransportProfile(profile.id); onProfilesChange(); }}>
                      <Trash2Icon />
                    </Button>
                  </>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => { setDraft(emptyDraft()); setError(null); }}>
              <PlusIcon data-icon="inline-start" />{intl.formatMessage({ id: 'user.settings.profilesAdd' })}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="transport-profile-name">{intl.formatMessage({ id: 'user.settings.profilesName' })}</Label>
              <Input id="transport-profile-name" maxLength={50} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transport-profile-type">{intl.formatMessage({ id: 'user.settings.profilesType' })}</Label>
              <Select value={draft.type} onValueChange={(value) => setDraft({ ...draft, type: value as FormType })}>
                <SelectTrigger id="transport-profile-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="peerjs">PeerJS / WebRTC</SelectItem>
                  <SelectItem value="supabase">Common / Supabase Realtime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.type === 'peerjs' ? (
              <div className="grid gap-2">
                <Label htmlFor="transport-peer-url">{intl.formatMessage({ id: 'user.settings.profilesPeerUrl' })}</Label>
                <Input id="transport-peer-url" type="url" placeholder="https://peer.example.com/peerjs" value={draft.serverUrl} onChange={(event) => setDraft({ ...draft, serverUrl: event.target.value })} />
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="transport-supabase-url">{intl.formatMessage({ id: 'user.settings.profilesSupabaseUrl' })}</Label>
                  <Input id="transport-supabase-url" type="url" placeholder="https://project.supabase.co" value={draft.supabaseUrl} onChange={(event) => setDraft({ ...draft, supabaseUrl: event.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="transport-supabase-key">{intl.formatMessage({ id: 'user.settings.profilesSupabaseKey' })}</Label>
                  <Input id="transport-supabase-key" type="password" value={draft.publishableKey} onChange={(event) => setDraft({ ...draft, publishableKey: event.target.value })} />
                </div>
              </>
            )}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <DialogFooter className="mx-0 mb-0 px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => { setDraft(null); setError(null); }}>{intl.formatMessage({ id: 'user.settings.profilesCancel' })}</Button>
              <Button type="button" onClick={save}>{intl.formatMessage({ id: 'user.settings.profilesSave' })}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
