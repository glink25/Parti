import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { ClipboardPasteIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { readTextFromClipboard } from '@/lib/clipboard';
import { parseAiRoomMarkdown, type AiRoomFiles } from './parseAiRoomMarkdown';

const FILE_LABELS: Record<keyof AiRoomFiles, string> = {
  manifest: 'parti.room.json',
  html: 'index.html',
  worker: 'room.worker.js',
};

export function AiResultImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (files: AiRoomFiles) => void;
}) {
  const intl = useIntl();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    if (!open) {
      setText('');
      setError(null);
      setPasting(false);
    }
  }, [open]);

  async function onPaste(): Promise<void> {
    setPasting(true);
    setError(null);
    try {
      const clipped = await readTextFromClipboard();
      if (!clipped) {
        setError(intl.formatMessage({ id: 'editor.error.clipboardFailed' }));
        return;
      }
      setText(clipped);
    } finally {
      setPasting(false);
    }
  }

  function onConfirm(): void {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) {
      setError(intl.formatMessage({ id: 'editor.aiImport.empty' }));
      return;
    }
    const parsed = parseAiRoomMarkdown(trimmed);
    if (!parsed.ok) {
      const names = parsed.missing.map((key) => FILE_LABELS[key]).join(', ');
      setError(intl.formatMessage({ id: 'editor.aiImport.parseFailed' }, { files: names }));
      return;
    }
    onImport(parsed.files);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <SparklesIcon className="mb-2 size-11 rounded-xl bg-secondary p-2.5 text-primary-bright" aria-hidden="true" />
          <DialogTitle><FormattedMessage id="editor.aiImport.title" /></DialogTitle>
          <DialogDescription><FormattedMessage id="editor.aiImport.description" /></DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <Textarea
            className="h-[min(50dvh,360px)] max-h-full min-h-0 flex-1 resize-none overflow-y-auto field-sizing-fixed font-mono text-xs leading-relaxed"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
            placeholder={intl.formatMessage({ id: 'editor.aiImport.placeholder' })}
            spellCheck={false}
          />
          {error && (
            <p role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={pasting} onClick={() => void onPaste()}>
            <ClipboardPasteIcon data-icon="inline-start" />
            <FormattedMessage id="editor.aiImport.paste" />
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={onConfirm}>
            <FormattedMessage id="editor.aiImport.confirm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
