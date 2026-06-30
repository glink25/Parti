import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeftIcon, ArrowRightIcon, EyeIcon, FilePlusIcon, PencilIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { createPackage, type RoomPackageInput } from '@parti/room-packager';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { Textarea } from '@/components/ui/textarea.js';
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
    <div className="page-shell creator-page">
      <div className="page-title-row">
        <div>
          <a className="back-link" href="#/">← 返回大厅</a>
          <span className="eyebrow">CREATE A ROOM</span>
          <h1>创建联机房间</h1>
          <p>选择一个模板开始创作，完成后立即邀请朋友加入。</p>
        </div>
      </div>

      {!showEditor && (
        <section className="creator-section">
          {error && <div className="notice error-notice">{error}</div>}
          <div className="template-grid">
            {templates.map((template) => {
              const cover = 'cover' in template ? template.cover : undefined;
              const selected = activeTemplate === template.id;
              return (
                <div className="template-card-wrap" key={template.id}>
                  <button
                    type="button"
                    className={`template-card${selected ? ' active' : ''}`}
                    disabled={templateBusy}
                    onClick={() => chooseTemplate(template)}
                  >
                    <span
                      className="template-cover"
                      aria-hidden="true"
                      style={cover ? { backgroundImage: `url(${cover})` } : undefined}
                    />
                    <span className="template-card-copy"><b>{template.name}</b><small>{template.description}</small></span>
                    {selected && <span className="template-check">已选择</span>}
                  </button>
                  {selected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="template-edit"
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
      <section className="creator-section">
        <button type="button" className="back-link editor-back" onClick={() => setShowEditor(false)}>
          <ArrowLeftIcon data-icon="inline-start" />返回选择模板
        </button>
        {error && <div className="notice error-notice">{error}</div>}
        <div className="code-workspace">
          <Tabs value={activeFile} onValueChange={(value) => setActiveFile(value as EditorFile)}>
          <TabsList className="file-tabs h-auto w-full justify-start rounded-none p-0" aria-label="房间文件">
            {(['manifest', 'html', 'worker'] as EditorFile[]).map((file) => {
              const label = file === 'manifest' ? 'parti.room.json' : file === 'html' ? 'index.html' : 'room.worker.js';
              return <TabsTrigger value={file} className="h-11 flex-none rounded-none border-r border-border px-4 font-mono text-xs data-active:bg-[#0c0f18] data-active:text-white" key={file}>{label}</TabsTrigger>;
            })}
          </TabsList>
          </Tabs>
          <label className="editor-field">
            <span className="sr-only">{fileLabel}</span>
            <Textarea className="min-h-[480px] resize-y rounded-none border-0 bg-[#0c0f18] p-5 font-mono text-[13px] leading-relaxed text-[#d9deeb] focus-visible:ring-0" value={fileValue} onChange={(event) => updateActiveFile(event.target.value)} rows={22} spellCheck={false} />
          </label>
        </div>

        <Card className="asset-panel gap-3 py-4">
          <div><b>附加文件</b><p>可加入样式或其他文本资源，文件会和房间内容一起保存。</p></div>
          <Button asChild variant="outline"><label><FilePlusIcon data-icon="inline-start" />添加文件<input className="hidden" type="file" multiple onChange={onUpload} /></label></Button>
          {Object.keys(extraFiles).length > 0 && (
            <div className="asset-list">
              {Object.keys(extraFiles).map((name) => (
                <span key={name}>{name}<Button size="icon-xs" variant="ghost" type="button" aria-label={`移除 ${name}`} onClick={() => { setExtraFiles((previous) => { const next = { ...previous }; delete next[name]; return next; }); setDirty(true); }}><XIcon /></Button></span>
              ))}
            </div>
          )}
        </Card>
      </section>
      )}

      <div className="creator-actions">
        <div><b>准备好了吗？</b><span>创建后可继续设置标题、密码和公开状态。</span></div>
        <div className="room-actions">
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
