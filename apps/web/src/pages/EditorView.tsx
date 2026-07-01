import { useEffect, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  FileArchiveIcon,
  FilePlusIcon,
  Link2Icon,
  PencilIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { createPackage, type RoomPackageInput } from '@parti/room-packager';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { Textarea } from '@/components/ui/textarea.js';
import { cn } from '@/lib/utils.js';
import { copyTextToClipboard } from '@/lib/clipboard.js';
import { createRoom } from '../lib/customRooms.js';
import { createDraftId } from '../lib/ids.js';
import { importRoomFromGitHub, importRoomFromZip } from '../lib/importRoom.js';
import { deleteImportedTemplate, recordTemplateUsage, saveDerivedTemplate } from '../lib/templates.js';
import { getTemplateList, resolvePackage, type TemplateListEntry } from '../lib/rooms.js';

type EditorFile = 'manifest' | 'html' | 'worker';
type BlankChoice = { id: 'blank'; name: string; description: string };
type SelectableTemplate = BlankChoice | TemplateListEntry;

const BLANK_TEMPLATE: BlankChoice = {
  id: 'blank',
  name: '空白房间',
  description: '从简洁的互动计数器开始，自由改造成你的玩法。',
};

const AI_ROOM_PROMPT = `请帮我创建一个可以直接导入 Parti 的多人联机游戏房间。

开始设计和编写代码前，请先阅读并理解以下 GitHub docs 目录中的全部文档：
https://github.com/glink25/Parti/tree/main/docs

请严格遵守文档中关于 Manifest、客户端 API、Worker API、协议和 Host Runtime 的约束，尤其注意房间状态必须由 Worker 权威管理，客户端只能通过 Parti API 读取状态和提交动作。

我的游戏创意如下（请让我在这里补充玩法、玩家人数、胜负条件和视觉风格）：
[在这里补充你的游戏创意]

如果需求中缺少会影响实现的关键信息，请先提出简短、必要的问题；信息足够后再生成最终结果。最终结果必须：
1. 给出可直接保存的完整文件结构，至少包含 parti.room.json、index.html 和 room.worker.js。
2. 分别输出三个文件的完整内容，不使用省略号、伪代码、占位实现或 Parti 不支持的依赖。
3. 确保 manifest 的入口文件、玩家人数和权限配置与代码一致。
4. 正确实现多人状态同步、服务端动作校验、胜负或结束条件，并安全处理异常或恶意输入。
5. UI 应清晰、响应式，并能在手机端正常操作。
6. 输出前自行复核代码与全部 Parti 文档约束，修正发现的问题。

请将最终答案整理成用户可以逐个保存文件、打包为 ZIP 后直接导入 Parti 的形式。`;

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

  // 首次加载模版列表（内置 + 导入，按使用次数排序），默认选中第一个。
  useEffect(() => {
    void (async () => {
      const list = await getTemplateList();
      setTemplates(list);
      await applyTemplate(list[0] ?? BLANK_TEMPLATE);
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
        setManifestText(blankManifest());
        setHtmlText(DEFAULT_HTML);
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
      setError(reason instanceof Error ? reason.message : String(reason));
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

  /** 从编辑器内容构造并校验包输入（用于空白/编辑后的派生包）。 */
  async function buildEditorInput(): Promise<RoomPackageInput | null> {
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
      return input;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }

  /** 解析出本次房间应指向的 templateId（未改动→复用模版；改动/空白→存派生包）。 */
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
      window.location.hash = target === 'local' ? `#/local/${roomId}` : `#/peer/host/${roomId}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
      setError(reason instanceof Error ? reason.message : String(reason));
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
    if (activeTemplate === entry.id) await applyTemplate(list[0] ?? BLANK_TEMPLATE);
  }

  async function copyAiPrompt(): Promise<void> {
    setAiCopyError(null);
    const ok = await copyTextToClipboard(AI_ROOM_PROMPT);
    if (!ok) {
      setAiCopyError('复制失败，请允许此页面访问剪贴板后重试。');
      return;
    }
    setAiPromptCopied(true);
    window.setTimeout(() => setAiPromptCopied(false), 1800);
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

  const startCardBtn =
    'flex w-full items-center justify-center gap-2 rounded-[11px] border border-border bg-surface px-3 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:not-disabled:border-border-strong hover:not-disabled:bg-surface-2 disabled:cursor-default disabled:opacity-60 [&_svg]:size-4';

  return (
    <div className="mx-auto w-[min(1240px,100%)] pb-24 md:pb-28">
      <div className="mb-[42px]">
        <div>
          <a className="mb-6 block w-max text-[13px] text-muted-foreground transition-colors hover:text-foreground" href="#/">← 返回大厅</a>
          <span className="mb-2.5 block text-[11px] font-extrabold tracking-[0.16em] text-primary-bright">CREATE A ROOM</span>
          <div className="mb-2.5 flex items-center gap-2.5 sm:gap-3">
            <h1 className="text-[clamp(34px,5vw,54px)] font-extrabold tracking-[-0.05em]">创建联机房间</h1>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mt-1 shrink-0 rounded-full text-primary-bright shadow-sm focus-visible:ring-2 focus-visible:ring-primary-bright/50 sm:mt-2"
              aria-label="使用 AI 创建房间"
              title="使用 AI 创建房间"
              onClick={() => setAiDialogOpen(true)}
            >
              <BotIcon aria-hidden="true" />
            </Button>
          </div>
          <p className="text-[15px] text-muted-foreground">选择一个模板开始创作，完成后立即邀请朋友加入。</p>
        </div>
      </div>

      {!showEditor && (
        <section className="mb-[42px]">
          {error && <div className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">{error}</div>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-[18px]">
            {/* 特殊首卡：新建房间的三种方式 */}
            <div
              className={cn(
                'flex flex-col gap-3 rounded-[18px] border border-dashed border-border-strong bg-[linear-gradient(150deg,var(--surface-2),var(--surface))] p-[18px] shadow-[0_10px_28px_rgba(91,72,15,0.07)]',
                isBlank && 'border-solid border-[#d6a900] shadow-[0_0_0_2px_rgba(214,169,0,0.32),0_18px_44px_rgba(214,169,0,0.18)]',
              )}
            >
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary-bright" aria-hidden="true" />
                <b className="text-sm md:text-base">新建房间</b>
              </div>
              <button
                type="button"
                className={cn(startCardBtn, isBlank && 'border-[#d6a900] text-primary-bright')}
                disabled={templateBusy || importing}
                onClick={() => chooseTemplate(BLANK_TEMPLATE)}
              >
                <SparklesIcon />从空白模版开始
              </button>
              <Button asChild variant="outline" className={cn(startCardBtn, 'h-auto')}>
                <label>
                  <FileArchiveIcon />{importing ? '导入中…' : '从 ZIP 导入'}
                  <input className="hidden" type="file" accept=".zip" disabled={importing} onChange={onZipSelected} />
                </label>
              </Button>
              <form onSubmit={onGithubSubmit} className="relative">
                <Link2Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  className={cn(startCardBtn, 'justify-start pr-9 pl-9 font-medium')}
                  type="url"
                  inputMode="url"
                  placeholder="粘贴 GitHub 地址，回车导入"
                  value={githubUrl}
                  disabled={importing}
                  onChange={(event) => setGithubUrl(event.target.value)}
                />
                {githubUrl.trim() && (
                  <button type="submit" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-primary-bright hover:bg-surface-2" disabled={importing} aria-label="导入 GitHub 房间">
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
                  {template.removable && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-2.5 right-2.5 z-[2] text-muted-foreground hover:text-destructive"
                      disabled={templateBusy || importing}
                      aria-label={`删除 ${template.name}`}
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

      <Dialog
        open={aiDialogOpen}
        onOpenChange={(open) => {
          setAiDialogOpen(open);
          if (!open) {
            setAiPromptCopied(false);
            setAiCopyError(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <BotIcon className="mb-2 size-11 rounded-xl bg-secondary p-2.5 text-primary-bright" aria-hidden="true" />
            <DialogTitle>让 AI 实现你的游戏创意</DialogTitle>
            <DialogDescription>
              复制一段为 Parti 准备的提示词，交给你常用的 AI，它会先阅读项目文档，再生成完整的房间代码。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="font-semibold text-foreground">AI 会生成这些必需文件</p>
              <div className="mt-2 flex flex-wrap gap-2 font-mono text-xs text-muted-foreground">
                <span className="rounded-md bg-surface px-2 py-1">parti.room.json</span>
                <span className="rounded-md bg-surface px-2 py-1">index.html</span>
                <span className="rounded-md bg-surface px-2 py-1">room.worker.js</span>
              </div>
            </div>

            <div>
              <p className="font-semibold text-foreground">使用方式</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
                <li>复制提示词并发送给 AI。</li>
                <li>补充玩法、玩家人数、胜负条件和视觉风格。</li>
                <li>检查生成的代码，将三个文件打包为 ZIP，或上传 GitHub 后回到这里导入。</li>
              </ol>
            </div>

            <p className="rounded-lg border border-primary-bright/20 bg-secondary/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              AI 生成的代码仍可能出错。导入前请检查内容，并先通过本地预览验证玩法。
            </p>

            {aiCopyError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                {aiCopyError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button className="w-full sm:w-auto" onClick={() => void copyAiPrompt()}>
              {aiPromptCopied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
              {aiPromptCopied ? '提示词已复制' : '让 AI 帮我创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
