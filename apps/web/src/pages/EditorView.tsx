import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeftIcon, ArrowRightIcon, EyeIcon, FilePlusIcon, PencilIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { createPackage, type RoomPackageInput } from '@parti/room-packager';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { Textarea } from '@/components/ui/textarea.js';
import { cn } from '@/lib/utils.js';
import { saveCustomRoom } from '../lib/customRooms.js';
import { ROOMS, resolvePackage, type RoomEntry } from '../lib/rooms.js';

type EditorFile = 'manifest' | 'html' | 'worker';
type TemplateChoice = { id: 'blank'; name: string; description: string; cover?: string } | RoomEntry;

const BLANK_TEMPLATE: TemplateChoice = {
  id: 'blank',
  name: '空白房间',
  description: '从简洁的互动计数器开始，自由改造成你的玩法。',
};

const DEFAULT_HTML = `<div style="font-family: system-ui, sans-serif; padding: 24px; color: #111;">
  <h1 style="font-size: 24px;">我的房间</h1>
  <div id="count" style="font-size: 48px; font-weight: 800;">0</div>
  <button id="inc" style="font-size: 16px; padding: 10px 18px;">+1</button>

  <script>
    const countEl = document.getElementById('count');
    parti.onState((state) => { countEl.textContent = String(state.count); });
    document.getElementById('inc').onclick = () => parti.action('increment');
    parti.ready();
  </script>
</div>
`;

const DEFAULT_WORKER = `import { defineRoom } from '@parti/worker-sdk';

export default defineRoom({
  initialState() {
    return { count: 0 };
  },
  actions: {
    increment(ctx) {
      ctx.state.count += 1;
      ctx.broadcast('counter:incremented', { count: ctx.state.count });
    },
  },
});
`;

function createDraftId(prefix = 'room'): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

function blankManifest(): string {
  return JSON.stringify(
    {
      partiVersion: '0.1.0',
      protocolVersion: 1,
      id: createDraftId(),
      name: '我的房间',
      version: '0.1.0',
      description: '和朋友一起玩的互动房间',
      entry: { ui: 'index.html', worker: 'room.worker.js' },
      room: { minPlayers: 1, maxPlayers: 8 },
      sync: { mode: 'snapshot' },
      permissions: { network: false, storage: 'session' },
    },
    null,
    2,
  );
}

export function EditorView() {
  const [manifestText, setManifestText] = useState(blankManifest);
  const [htmlText, setHtmlText] = useState(DEFAULT_HTML);
  const [workerText, setWorkerText] = useState(DEFAULT_WORKER);
  const [extraFiles, setExtraFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<EditorFile>('manifest');
  const [activeTemplate, setActiveTemplate] = useState(ROOMS[0]?.id ?? 'blank');
  const [pendingTemplate, setPendingTemplate] = useState<TemplateChoice | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const templates: TemplateChoice[] = [BLANK_TEMPLATE, ...ROOMS];

  // 进入页面默认选中第二个模板（第一个固定为空白模板），并预加载其内容。
  useEffect(() => {
    void applyTemplate(templates[1] ?? BLANK_TEMPLATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyTemplate(template: TemplateChoice): Promise<void> {
    setTemplateBusy(true);
    setError(null);
    try {
      if (template.id === 'blank') {
        setManifestText(blankManifest());
        setHtmlText(DEFAULT_HTML);
        setWorkerText(DEFAULT_WORKER);
        setExtraFiles({});
      } else {
        const pkg = await resolvePackage(template.id);
        const manifest = {
          ...pkg.manifest,
          id: createDraftId(template.id),
        };
        const uiName = manifest.entry.ui;
        const workerName = manifest.entry.worker;
        setManifestText(JSON.stringify(manifest, null, 2));
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTemplateBusy(false);
      setPendingTemplate(null);
    }
  }

  function chooseTemplate(template: TemplateChoice): void {
    if (template.id === activeTemplate) return;
    if (dirty) {
      setPendingTemplate(template);
      return;
    }
    void applyTemplate(template);
  }

  async function build(): Promise<string | null> {
    setError(null);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      setError('房间配置不是有效的 JSON，请检查后重试。');
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
      return saveCustomRoom(input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }

  async function onCreate(target: 'local' | 'peer'): Promise<void> {
    setBusy(true);
    try {
      const id = await build();
      if (!id) return;
      window.location.hash = target === 'local' ? `#/local/${id}` : `#/peer/host/${id}`;
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

  const isBlank = activeTemplate === 'blank';
  // grid 视图选中非空白模板可直接创建；空白模板需先「继续创建」进入编辑器。
  const goCreate = showEditor || !isBlank;
  const fileValue = activeFile === 'manifest' ? manifestText : activeFile === 'html' ? htmlText : workerText;
  const fileLabel = activeFile === 'manifest' ? 'parti.room.json' : activeFile === 'html' ? 'index.html' : 'room.worker.js';

  function updateActiveFile(value: string): void {
    if (activeFile === 'manifest') setManifestText(value);
    else if (activeFile === 'html') setHtmlText(value);
    else setWorkerText(value);
    setDirty(true);
  }

  return (
    <div className="mx-auto w-[min(1240px,100%)] pb-24 md:pb-28">
      <div className="mb-[42px]">
        <div>
          <a className="mb-6 block w-max text-[13px] text-muted-foreground transition-colors hover:text-foreground" href="#/">← 返回大厅</a>
          <span className="mb-2.5 block text-[11px] font-extrabold tracking-[0.16em] text-primary-bright">CREATE A ROOM</span>
          <h1 className="mb-2.5 text-[clamp(34px,5vw,54px)] font-extrabold tracking-[-0.05em]">创建联机房间</h1>
          <p className="text-[15px] text-muted-foreground">选择一个模板开始创作，完成后立即邀请朋友加入。</p>
        </div>
      </div>

      {!showEditor && (
        <section className="mb-[42px]">
          {error && <div className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">{error}</div>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-[18px]">
            {templates.map((template) => {
              const cover = 'cover' in template ? template.cover : undefined;
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
                      style={cover ? { backgroundImage: `url(${cover})` } : undefined}
                    />
                    <span className="flex flex-col gap-2 px-[13px] pt-3 pb-3.5 md:px-5 md:pt-[18px] md:pb-5">
                      <b className="text-sm md:text-base">{template.name}</b>
                      <small className="text-xs font-medium leading-[1.55] text-muted-foreground">{template.description}</small>
                    </span>
                    {selected && <span className="absolute top-3 right-3 rounded-full bg-success/15 px-2.5 py-[3px] text-[10px] font-bold text-success">已选择</span>}
                  </button>
                  {selected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2.5 left-2.5 z-[2] h-auto gap-[3px] px-2 py-[3px] text-[11px] [&_svg]:size-3"
                      disabled={templateBusy}
                      onClick={() => setShowEditor(true)}
                    >
                      <PencilIcon data-icon="inline-start" />继续编辑
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
          <ArrowLeftIcon data-icon="inline-start" />返回选择模板
        </button>
        {error && <div className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">{error}</div>}
        <div className="overflow-hidden rounded-[17px] border border-border bg-[#0c0f18] shadow-[0_18px_55px_rgba(0,0,0,0.25)]">
          <Tabs value={activeFile} onValueChange={(value) => setActiveFile(value as EditorFile)}>
          <TabsList className="flex h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border bg-surface p-0" aria-label="房间文件">
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
          <div className="flex-1"><b className="text-[13px]">附加文件</b><p className="mt-1 text-[11px] text-muted-foreground">可加入样式或其他文本资源，文件会和房间内容一起保存。</p></div>
          <Button asChild variant="outline"><label><FilePlusIcon data-icon="inline-start" />添加文件<input className="hidden" type="file" multiple onChange={onUpload} /></label></Button>
          {Object.keys(extraFiles).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(extraFiles).map((name) => (
                <span key={name} className="flex items-center gap-1 rounded-[7px] bg-surface-3 px-[7px] py-1 text-[10px] text-muted-foreground">{name}<Button size="icon-xs" variant="ghost" type="button" aria-label={`移除 ${name}`} onClick={() => { setExtraFiles((previous) => { const next = { ...previous }; delete next[name]; return next; }); setDirty(true); }}><XIcon /></Button></span>
              ))}
            </div>
          )}
        </Card>
      </section>
      )}

      <div className="fixed bottom-4 left-1/2 z-40 flex w-[min(1240px,calc(100%-48px))] -translate-x-1/2 items-center justify-between gap-6 rounded-[18px] border border-border-strong bg-card/92 px-[18px] py-4 shadow-[0_16px_45px_rgba(91,72,15,0.14)] backdrop-blur-lg max-md:bottom-0 max-md:w-full max-md:items-stretch max-md:rounded-t-[20px] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:px-4 max-md:pt-3 max-md:pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-1 max-md:hidden"><b className="text-[15px]">准备好了吗？</b><span className="text-[11px] text-muted-foreground">创建后可继续设置标题、密码和公开状态。</span></div>
        <div className="flex flex-wrap items-center gap-2.5 max-md:w-full max-md:flex-nowrap max-md:[&>*]:min-h-12 max-md:[&>*]:flex-1">
          {goCreate ? (
            <>
              {import.meta.env.DEV && <Button variant="outline" disabled={busy} onClick={() => void onCreate('local')}><EyeIcon data-icon="inline-start" />本地预览</Button>}
              <Button size="lg" disabled={busy} onClick={() => void onCreate('peer')}>{busy ? '正在创建…' : '创建联机房间'} <ArrowRightIcon data-icon="inline-end" /></Button>
            </>
          ) : (
            <Button size="lg" disabled={templateBusy} onClick={() => setShowEditor(true)}>继续创建 <ArrowRightIcon data-icon="inline-end" /></Button>
          )}
        </div>
      </div>

      <Dialog open={Boolean(pendingTemplate)} onOpenChange={(open) => { if (!open) setPendingTemplate(null); }}>
        <DialogContent>
          <DialogHeader>
            <RotateCcwIcon className="mb-2 size-11 rounded-xl bg-secondary p-2.5 text-primary-bright" aria-hidden="true" />
            <DialogTitle>替换当前内容？</DialogTitle>
            <DialogDescription>切换到“{pendingTemplate?.name}”会替换当前代码和附加文件，此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTemplate(null)}>保留当前内容</Button>
            <Button onClick={() => { if (pendingTemplate) void applyTemplate(pendingTemplate); }}>确认替换</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
