import { FormattedMessage, useIntl } from 'react-intl';
import { BotIcon, CheckIcon, CopyIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import type { SelectableTemplate } from './editorDefaults.js';

export function TemplateReplaceDialog({ pending, onCancel, onConfirm }: { pending: SelectableTemplate | null; onCancel: () => void; onConfirm: () => void }) {
  const intl = useIntl();
  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <RotateCcwIcon className="mb-2 size-11 rounded-xl bg-secondary p-2.5 text-primary-bright" aria-hidden="true" />
          <DialogTitle><FormattedMessage id="editor.template.replaceTitle" /></DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: 'editor.template.replaceDescription' }, { name: pending?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}><FormattedMessage id="editor.template.keepCurrent" /></Button>
          <Button onClick={onConfirm}><FormattedMessage id="editor.template.confirmReplace" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AiCreationDialog({ open, copied, error, onOpenChange, onCopy }: { open: boolean; copied: boolean; error: string | null; onOpenChange: (open: boolean) => void; onCopy: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <BotIcon className="mb-2 size-11 rounded-xl bg-secondary p-2.5 text-primary-bright" aria-hidden="true" />
          <DialogTitle><FormattedMessage id="editor.ai.dialogTitle" /></DialogTitle>
          <DialogDescription><FormattedMessage id="editor.ai.dialogDescription" /></DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <p className="font-semibold text-foreground"><FormattedMessage id="editor.ai.filesTitle" /></p>
            <div className="mt-2 flex flex-wrap gap-2 font-mono text-xs text-muted-foreground">
              <span className="rounded-md bg-surface px-2 py-1">parti.room.json</span>
              <span className="rounded-md bg-surface px-2 py-1">index.html</span>
              <span className="rounded-md bg-surface px-2 py-1">room.worker.js</span>
            </div>
          </div>
          <div>
            <p className="font-semibold text-foreground"><FormattedMessage id="editor.ai.stepsTitle" /></p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li><FormattedMessage id="editor.ai.step1" /></li>
              <li><FormattedMessage id="editor.ai.step2" /></li>
              <li><FormattedMessage id="editor.ai.step3" /></li>
            </ol>
          </div>
          <p className="rounded-lg border border-primary-bright/20 bg-secondary/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <FormattedMessage id="editor.ai.warning" />
          </p>
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button className="w-full sm:w-auto" onClick={onCopy}>
            {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
            <FormattedMessage id={copied ? 'editor.ai.copied' : 'editor.ai.copy'} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
