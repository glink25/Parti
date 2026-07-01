import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  FileArchiveIcon,
  FilePlusIcon,
  Link2Icon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { createPackage, type RoomPackageInput } from '@parti/room-packager';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { Textarea } from '@/components/ui/textarea.js';
import { cn } from '@/lib/utils.js';
import { copyTextToClipboard } from '@/lib/clipboard.js';
import { createRoom } from '../lib/customRooms.js';
import { importRoomFromGitHub, importRoomFromZip } from '../lib/importRoom.js';
import { deleteImportedTemplate, recordTemplateUsage, saveDerivedTemplate } from '../lib/templates.js';
import { getTemplateList, resolvePackage, type TemplateListEntry } from '../lib/rooms.js';
import { useLocale } from '@/i18n/LocaleProvider.js';
import { formatResolveError, templateDescription } from '@/i18n/formatErrors.js';
import {
  blankManifest,
  getAiRoomPrompt,
  getBlankTemplate,
  getDefaultHtml,
  DEFAULT_WORKER,
  type EditorFile,
  type SelectableTemplate,
} from '@/components/editor/editorDefaults.js';
import { AiCreationDialog, TemplateReplaceDialog } from '@/components/editor/EditorDialogs.js';
import { EditorActionDock } from '@/components/editor/EditorActionDock.js';

function formatError(intl: ReturnType<typeof useIntl>, reason: unknown): string {
  return formatResolveError(intl, reason);
}

export function EditorView() {
  const intl = useIntl();
  const { locale } = useLocale();
  const blankTemplate = getBlankTemplate(locale);

  const [manifestText, setManifestText] = useState(() => blankManifest(locale));
  const [htmlText, setHtmlText] = useState(() => getDefaultHtml(locale));
  const [workerText, setWorkerText] = useState(DEFAULT_WORKER);
  const [extraFiles, setExtraFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<EditorFile>('manifest');
  const [templates, setTemplates] = useState<TemplateListEntry[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<string>('blank');
  const [pendingTemplate, setPendingTemplate] = useState<SelectableTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPromptCopied, setAiPromptCopied] = useState(false);
  const [aiCopyError, setAiCopyError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const list = await getTemplateList();
      setTemplates(list);
      await applyTemplate(list[0] ?? blankTemplate);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadTemplates(): Promise<TemplateListEntry[]> {
    const list = await getTemplateList();
    setTemplates(list);
    return list;
  }

  async function applyTemplate(template: SelectableTemplate): Promise<void> {
    setTemplateBusy(true);
    setError(null);
    try {
      if (template.id === 'blank') {
        setManifestText(blankManifest(locale));
        setHtmlText(getDefaultHtml(locale));
        setWorkerText(DEFAULT_WORKER);
        setExtraFiles({});
      } else {
        const pkg = await resolvePackage(template.id);
        const uiName = pkg.manifest.entry.ui;
        const workerName = pkg.manifest.entry.worker;
        setManifestText(JSON.stringify(pkg.manifest, null, 2));
        setHtmlText(pkg.files[uiName] ?? '');
        setWorkerText(pkg.files[workerName] ?? '');
        setExtraFiles(
          Object.fromEntries(
            Object.entries(pkg.files).filter(([name]) => name !== uiName && name !== workerName),
          ),
        );
      }
      setActiveTemplate(template.id);
      setActiveFile('manifest');
      setDirty(false);
    } catch (reason) {
      setError(formatError(intl, reason));
    } finally {
      setTemplateBusy(false);
      setPendingTemplate(null);
    }
  }

  function chooseTemplate(template: SelectableTemplate): void {
    if (template.id === activeTemplate) return;
    if (dirty) {
      setPendingTemplate(template);
      return;
    }
    void applyTemplate(template);
  }

  async function buildEditorInput(): Promise<RoomPackageInput | null> {
    setError(null);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      setError(intl.formatMessage({ id: 'editor.error.invalidJson' }));
      setActiveFile('manifest');
      return null;
    }
    const entry = (manifest as { entry?: { ui?: string; worker?: string } }).entry;
    const uiName = entry?.ui ?? 'index.html';
    const workerName = entry?.worker ?? 'room.worker.js';
    const input: RoomPackageInput = {
      manifest,
      files: { ...extraFiles, [uiName]: htmlText, [workerName]: workerText },
    };
    try {
      await createPackage(input);
      return input;
    } catch (reason) {
      setError(formatError(intl, reason));
      return null;
    }
  }

  async function resolveTemplateId(): Promise<string | null> {
    if (!dirty && activeTemplate !== 'blank') return activeTemplate;
    const input = await buildEditorInput();
    if (!input) return null;
    return saveDerivedTemplate(input);
  }

  async function onCreate(target: 'local' | 'peer'): Promise<void> {
    setBusy(true);
    try {
      const templateId = await resolveTemplateId();
      if (!templateId) return;
      const roomId = await createRoom(templateId);
      if (activeTemplate !== 'blank') await recordTemplateUsage(activeTemplate);
      window.location.hash = target === 'local' ? `#/local/${roomId}` : `#/online/host/${roomId}`;
    } catch (reason) {
      setError(formatError(intl, reason));
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const list = event.target.files;
    if (!list) return;
    const next: Record<string, string> = {};
    for (const file of Array.from(list)) next[file.name] = await file.text();
    setExtraFiles((previous) => ({ ...previous, ...next }));
    setDirty(true);
    event.target.value = '';
  }

  async function runImport(task: () => Promise<string>): Promise<void> {
    setImporting(true);
    setError(null);
    try {
      const id = await task();
      const list = await reloadTemplates();
      const entry = list.find((t) => t.id === id);
      if (entry) await applyTemplate(entry);
    } catch (reason) {
      setError(formatError(intl, reason));
    } finally {
      setImporting(false);
    }
  }

  async function onZipSelected(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runImport(() => importRoomFromZip(file));
  }

  async function onGithubSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const url = githubUrl.trim();
    if (!url || importing) return;
    await runImport(() => importRoomFromGitHub(url));
    setGithubUrl('');
  }

  async function onDeleteTemplate(entry: TemplateListEntry): Promise<void> {
    await deleteImportedTemplate(entry.id);
    const list = await reloadTemplates();
    if (activeTemplate === entry.id) await applyTemplate(list[0] ?? blankTemplate);
  }

  async function copyAiPrompt(): Promise<void> {
    setAiCopyError(null);
    const ok = await copyTextToClipboard(getAiRoomPrompt(locale));
    if (!ok) {
      setAiCopyError(intl.formatMessage({ id: 'editor.error.clipboardFailed' }));
      return;
    }
    setAiPromptCopied(true);
    window.setTimeout(() => setAiPromptCopied(false), 1800);
  }

  const isBlank = activeTemplate === 'blank';
  const goCreate = showEditor || !isBlank;
  const fileValue = activeFile === 'manifest' ? manifestText : activeFile === 'html' ? htmlText : workerText;
  const fileLabel = activeFile === 'manifest' ? 'parti.room.json' : activeFile === 'html' ? 'index.html' : 'room.worker.js';

  function updateActiveFile(value: string): void {
    if (activeFile === 'manifest') setManifestText(value);
    else if (activeFile === 'html') setHtmlText(value);
    else setWorkerText(value);
    setDirty(true);
  }

  const startCardBtn =
    'flex w-full items-center justify-center gap-2 rounded-[11px] border border-border bg-surface px-3 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:not-disabled:border-border-strong hover:not-disabled:bg-surface-2 disabled:cursor-default disabled:opacity-60 [&_svg]:size-4';

  return (
    <div className="mx-auto w-[min(1240px,100%)] pb-24 md:pb-28">
      <div className="mb-[42px]">
        <div>
          <a className="mb-6 block w-max text-[13px] text-muted-foreground transition-colors hover:text-foreground" href="#/">
            <FormattedMessage id="editor.backToLobby" />
          </a>
          <span className="mb-2.5 block text-[11px] font-extrabold tracking-[0.16em] text-primary-bright">CREATE A ROOM</span>
          <div className="mb-2.5 flex items-center gap-2.5 sm:gap-3">
            <h1 className="text-[clamp(34px,5vw,54px)] font-extrabold tracking-[-0.05em]">
              <FormattedMessage id="editor.title" />
            </h1>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mt-1 shrink-0 rounded-full text-primary-bright shadow-sm focus-visible:ring-2 focus-visible:ring-primary-bright/50 sm:mt-2"
              aria-label={intl.formatMessage({ id: 'editor.aiCreateAria' })}
              title={intl.formatMessage({ id: 'editor.aiCreateAria' })}
              onClick={() => setAiDialogOpen(true)}
            >
              <BotIcon aria-hidden="true" />
            </Button>
          </div>
          <p className="text-[15px] text-muted-foreground"><FormattedMessage id="editor.description" /></p>
        </div>
      </div>

      {!showEditor && (
        <section className="mb-[42px]">
          {error && <div className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">{error}</div>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-[18px]">
            <div
              className={cn(
                'flex flex-col gap-3 rounded-[18px] border border-dashed border-border-strong bg-[linear-gradient(150deg,var(--surface-2),var(--surface))] p-[18px] shadow-[0_10px_28px_rgba(91,72,15,0.07)]',
                isBlank && 'border-solid border-[#d6a900] shadow-[0_0_0_2px_rgba(214,169,0,0.32),0_18px_44px_rgba(214,169,0,0.18)]',
              )}
            >
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary-bright" aria-hidden="true" />
                <b className="text-sm md:text-base"><FormattedMessage id="editor.newRoom.title" /></b>
              </div>
              <button
                type="button"
                className={cn(startCardBtn, isBlank && 'border-[#d6a900] text-primary-bright')}
                disabled={templateBusy || importing}
                onClick={() => chooseTemplate(blankTemplate)}
              >
                <SparklesIcon /><FormattedMessage id="editor.newRoom.blank" />
              </button>
              <Button asChild variant="outline" className={cn(startCardBtn, 'h-auto')}>
                <label>
                  <FileArchiveIcon />
                  {importing ? intl.formatMessage({ id: 'editor.newRoom.importing' }) : intl.formatMessage({ id: 'editor.newRoom.importZip' })}
                  <input className="hidden" type="file" accept=".zip" disabled={importing} onChange={onZipSelected} />
                </label>
              </Button>
              <form onSubmit={onGithubSubmit} className="relative">
                <Link2Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  className={cn(startCardBtn, 'justify-start pr-9 pl-9 font-medium')}
                  type="url"
                  inputMode="url"
                  placeholder={intl.formatMessage({ id: 'editor.newRoom.githubPlaceholder' })}
                  value={githubUrl}
                  disabled={importing}
                  onChange={(event) => setGithubUrl(event.target.value)}
                />
                {githubUrl.trim() && (
                  <button type="submit" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-primary-bright hover:bg-surface-2" disabled={importing} aria-label={intl.formatMessage({ id: 'editor.newRoom.githubImportAria' })}>
                    <ArrowRightIcon className="size-4" />
                  </button>
                )}
              </form>
            </div>

            {templates.map((template) => {
              const selected = activeTemplate === template.id;
              return (
                <div className="relative" key={template.id}>
                  <button
                    type="button"
                    className={cn(
                      'relative flex w-full cursor-pointer flex-col items-stretch overflow-hidden rounded-[18px] border border-border bg-surface text-left text-foreground shadow-[0_10px_28px_rgba(91,72,15,0.07)] transition-[transform,box-shadow,border-color] duration-150 hover:not-disabled:-translate-y-[3px] hover:not-disabled:border-border-strong hover:not-disabled:shadow-[0_20px_46px_rgba(91,72,15,0.16)] disabled:cursor-default disabled:opacity-70',
                      selected && 'border-[#d6a900] shadow-[0_0_0_2px_rgba(214,169,0,0.32),0_18px_44px_rgba(214,169,0,0.18)]',
                    )}
                    disabled={templateBusy}
                    onClick={() => chooseTemplate(template)}
                  >
                    <span
                      className="block aspect-[16/10] w-full bg-[linear-gradient(135deg,rgba(155,113,0,0.22),rgba(139,92,246,0.18)_55%,rgba(81,219,147,0.2))] bg-cover bg-center"
                      aria-hidden="true"
                      style={template.cover ? { backgroundImage: `url(${template.cover})` } : undefined}
                    />
                    <span className="flex flex-col gap-2 px-[13px] pt-3 pb-3.5 md:px-5 md:pt-[18px] md:pb-5">
                      <b className="text-sm md:text-base">{template.name}</b>
                      <small className="text-xs font-medium leading-[1.55] text-muted-foreground">
                        {templateDescription(intl, template)}
                      </small>
                    </span>
                    {selected && (
                      <span className="absolute top-3 right-3 rounded-full bg-success/15 px-2.5 py-[3px] text-[10px] font-bold text-success">
                        <FormattedMessage id="editor.template.selected" />
                      </span>
                    )}
                  </button>
                  {selected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2.5 left-2.5 z-[2] h-auto gap-[3px] px-2 py-[3px] text-[11px] [&_svg]:size-3"
                      disabled={templateBusy}
                      onClick={() => setShowEditor(true)}
                    >
                      <PencilIcon data-icon="inline-start" /><FormattedMessage id="editor.template.continueEdit" />
                    </Button>
                  )}
                  {template.removable && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-2.5 right-2.5 z-[2] text-muted-foreground hover:text-destructive"
                      disabled={templateBusy || importing}
                      aria-label={intl.formatMessage({ id: 'editor.template.deleteAria' }, { name: template.name })}
                      onClick={() => void onDeleteTemplate(template)}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showEditor && (
      <section className="mb-[42px]">
        <button type="button" className="mb-[18px] inline-flex w-max cursor-pointer items-center gap-1 border-0 bg-transparent text-[13px] text-muted-foreground transition-colors hover:text-foreground" onClick={() => setShowEditor(false)}>
          <ArrowLeftIcon data-icon="inline-start" /><FormattedMessage id="editor.backToTemplates" />
        </button>
        {error && <div className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">{error}</div>}
        <div className="overflow-hidden rounded-[17px] border border-border bg-[#0c0f18] shadow-[0_18px_55px_rgba(0,0,0,0.25)]">
          <Tabs value={activeFile} onValueChange={(value) => setActiveFile(value as EditorFile)}>
          <TabsList className="flex h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border bg-surface p-0" aria-label={intl.formatMessage({ id: 'editor.files.ariaLabel' })}>
            {(['manifest', 'html', 'worker'] as EditorFile[]).map((file) => {
              const label = file === 'manifest' ? 'parti.room.json' : file === 'html' ? 'index.html' : 'room.worker.js';
              return <TabsTrigger value={file} className="h-11 flex-none rounded-none border-r border-border px-4 font-mono text-xs data-active:bg-[#0c0f18] data-active:text-white" key={file}>{label}</TabsTrigger>;
            })}
          </TabsList>
          </Tabs>
          <label className="block">
            <span className="sr-only">{fileLabel}</span>
            <Textarea className="min-h-[480px] resize-y rounded-none border-0 bg-[#0c0f18] p-5 font-mono text-[13px] leading-relaxed text-[#d9deeb] focus-visible:ring-0" value={fileValue} onChange={(event) => updateActiveFile(event.target.value)} rows={22} spellCheck={false} />
          </label>
        </div>

        <Card className="mt-3 flex flex-col items-start gap-4 rounded-[14px] border-border bg-surface px-[18px] py-[17px] sm:flex-row sm:items-center">
          <div className="flex-1">
            <b className="text-[13px]"><FormattedMessage id="editor.files.extraTitle" /></b>
            <p className="mt-1 text-[11px] text-muted-foreground"><FormattedMessage id="editor.files.extraDescription" /></p>
          </div>
          <Button asChild variant="outline">
            <label>
              <FilePlusIcon data-icon="inline-start" /><FormattedMessage id="editor.files.addFile" />
              <input className="hidden" type="file" multiple onChange={onUpload} />
            </label>
          </Button>
          {Object.keys(extraFiles).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(extraFiles).map((name) => (
                <span key={name} className="flex items-center gap-1 rounded-[7px] bg-surface-3 px-[7px] py-1 text-[10px] text-muted-foreground">
                  {name}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    aria-label={intl.formatMessage({ id: 'editor.files.removeAria' }, { name })}
                    onClick={() => { setExtraFiles((previous) => { const next = { ...previous }; delete next[name]; return next; }); setDirty(true); }}
                  >
                    <XIcon />
                  </Button>
                </span>
              ))}
            </div>
          )}
        </Card>
      </section>
      )}

      <EditorActionDock canCreate={goCreate} busy={busy} templateBusy={templateBusy} onEdit={() => setShowEditor(true)} onCreate={(target) => void onCreate(target)} />

      <TemplateReplaceDialog pending={pendingTemplate} onCancel={() => setPendingTemplate(null)} onConfirm={() => { if (pendingTemplate) void applyTemplate(pendingTemplate); }} />
      <AiCreationDialog open={aiDialogOpen} copied={aiPromptCopied} error={aiCopyError} onOpenChange={(open) => { setAiDialogOpen(open); if (!open) { setAiPromptCopied(false); setAiCopyError(null); } }} onCopy={() => void copyAiPrompt()} />
    </div>
  );
}
