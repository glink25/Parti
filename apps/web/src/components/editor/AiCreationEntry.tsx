import { useState } from 'react';
import { useIntl } from 'react-intl';
import { BotIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n/LocaleProvider';
import { copyTextToClipboard, readTextFromClipboard } from '@/lib/clipboard';
import { AiCreationDialog } from './EditorDialogs';
import { getAiRoomPrompt } from './editorDefaults';

const AI_IMPORT_HANDOFF_KEY = 'parti:ai-import-handoff';
let nextAiImportToken = Date.now();

export type AiImportHandoff = {
  initialText: string;
  autoConfirm: true;
  autoConfirmToken: number;
  clipboardReadFailed: boolean;
};

export function saveAiImportHandoff(handoff: AiImportHandoff): void {
  sessionStorage.setItem(AI_IMPORT_HANDOFF_KEY, JSON.stringify(handoff));
}

export function consumeAiImportHandoff(): AiImportHandoff | null {
  const stored = sessionStorage.getItem(AI_IMPORT_HANDOFF_KEY);
  sessionStorage.removeItem(AI_IMPORT_HANDOFF_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as AiImportHandoff;
  } catch {
    return null;
  }
}

export function AiCreationEntry({
  onGoAdd,
}: {
  onGoAdd: (handoff: AiImportHandoff) => void;
}) {
  const intl = useIntl();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetFeedback(): void {
    setCopied(false);
    setError(null);
  }

  async function copyPrompt(): Promise<void> {
    setError(null);
    const ok = await copyTextToClipboard(getAiRoomPrompt(locale));
    if (!ok) {
      setError(intl.formatMessage({ id: 'editor.error.clipboardFailed' }));
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function goAdd(): Promise<void> {
    const clipped = await readTextFromClipboard();
    setOpen(false);
    resetFeedback();
    nextAiImportToken += 1;
    onGoAdd({
      initialText: clipped ?? '',
      autoConfirm: true,
      autoConfirmToken: nextAiImportToken,
      clipboardReadFailed: !clipped,
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1 h-auto shrink-0 gap-2 rounded-full px-3 py-2 text-primary-bright shadow-sm focus-visible:ring-2 focus-visible:ring-primary-bright/50 sm:mt-2"
        aria-label={intl.formatMessage({ id: 'editor.aiCreateAria' })}
        title={intl.formatMessage({ id: 'editor.aiCreateAria' })}
        onClick={() => setOpen(true)}
      >
        <BotIcon aria-hidden="true" />
        {intl.formatMessage({ id: 'editor.aiCreateDescription' })}
      </Button>
      <AiCreationDialog
        open={open}
        copied={copied}
        error={error}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetFeedback();
        }}
        onCopy={() => void copyPrompt()}
        onGoAdd={() => void goAdd()}
      />
    </>
  );
}
