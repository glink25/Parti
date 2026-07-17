import { FormattedMessage, useIntl } from 'react-intl';
import { ArrowRightIcon, EyeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function EditorActionDock({ canCreate, busy, selectionReady, showLocalPreview, onEdit, onCreate }: { canCreate: boolean; busy: boolean; selectionReady: boolean; showLocalPreview: boolean; onEdit: () => void; onCreate: (target: 'local' | 'peer') => void }) {
  const intl = useIntl();
  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex w-[min(1240px,calc(100%-48px))] -translate-x-1/2 items-center justify-between gap-6 rounded-[18px] border border-border-strong bg-card/92 px-[18px] py-4 shadow-[0_16px_45px_rgba(91,72,15,0.14)] backdrop-blur-lg max-md:bottom-0 max-md:w-full max-md:items-stretch max-md:rounded-t-[20px] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:px-4 max-md:pt-3 max-md:pb-[calc(12px+env(safe-area-inset-bottom))]">
      <div className="flex flex-col gap-1 max-md:hidden">
        <b className="text-[15px]"><FormattedMessage id="editor.dock.readyTitle" /></b>
        <span className="text-[11px] text-muted-foreground"><FormattedMessage id="editor.dock.readyDescription" /></span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 max-md:w-full max-md:flex-nowrap max-md:[&>*]:min-h-12 max-md:[&>*]:flex-1">
        {canCreate ? (
          <>
            {showLocalPreview && (
              <Button variant="outline" disabled={busy || !selectionReady} onClick={() => onCreate('local')}>
                <EyeIcon data-icon="inline-start" /><FormattedMessage id="editor.dock.localPreview" />
              </Button>
            )}
            <Button size="lg" disabled={busy || !selectionReady} onClick={() => onCreate('peer')}>
              {busy ? intl.formatMessage({ id: 'editor.dock.creating' }) : intl.formatMessage({ id: 'editor.dock.createPeer' })}
              {' '}<ArrowRightIcon data-icon="inline-end" />
            </Button>
          </>
        ) : (
          <Button size="lg" onClick={onEdit}>
            <FormattedMessage id="editor.dock.continueCreate" /> <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}
