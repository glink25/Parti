import { useState } from 'react';
import { useIntl } from 'react-intl';
import { ArrowRightIcon, ClipboardPasteIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readTextFromClipboard } from '@/lib/clipboard';
import { navigateToPeerJoin, parseInviteInput } from '../lib/peerRoutes';

export function JoinLinkInput() {
  const intl = useIntl();
  const [value, setValue] = useState('');
  const [showError, setShowError] = useState(false);
  const joinRoute = parseInviteInput(value);

  function submit(inputValue = value): void {
    const route = parseInviteInput(inputValue);
    if (!route) {
      setShowError(true);
      return;
    }
    navigateToPeerJoin(route);
  }

  async function handlePaste(): Promise<void> {
    const text = await readTextFromClipboard();
    if (!text?.trim()) return;
    const trimmed = text.trim();
    setValue(trimmed);
    setShowError(false);
    submit(trimmed);
  }

  return (
    <div className="relative min-w-0 flex-1 max-md:w-full">
      <div
        className={cn(
          'flex h-12 items-center gap-1 rounded-xl border border-border bg-surface/90 px-3 shadow-sm backdrop-blur-sm',
          showError && !joinRoute && value.trim() && 'border-danger/60',
        )}
      >
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setShowError(false);
          }}
          onBlur={() => {
            if (value.trim() && !joinRoute) setShowError(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={intl.formatMessage({ id: 'lobby.hero.joinPlaceholder' })}
          className="min-w-[160px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-invalid={showError && !joinRoute && !!value.trim()}
        />
        {!value.trim() ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={intl.formatMessage({ id: 'lobby.hero.pasteJoinAria' })}
            onClick={() => void handlePaste()}
          >
            <ClipboardPasteIcon />
          </Button>
        ) : joinRoute ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-primary-bright hover:text-primary-bright"
            aria-label={intl.formatMessage({ id: 'lobby.hero.joinSubmitAria' })}
            onClick={() => submit()}
          >
            <ArrowRightIcon />
          </Button>
        ) : null}
      </div>
      {showError && !joinRoute && value.trim() ? (
        <p className="absolute top-full left-0 mt-1.5 max-w-full text-xs text-danger">
          {intl.formatMessage({ id: 'lobby.join.invalidLink' })}
        </p>
      ) : null}
    </div>
  );
}
