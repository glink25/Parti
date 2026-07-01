import { BotIcon, CheckIcon, CopyIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import type { SelectableTemplate } from './editorDefaults.js';

export function TemplateReplaceDialog({ pending, onCancel, onConfirm }: { pending: SelectableTemplate | null; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) onCancel(); }}><DialogContent><DialogHeader><RotateCcwIcon className="mb-2 size-11 rounded-xl bg-secondary p-2.5 text-primary-bright" aria-hidden="true" /><DialogTitle>替换当前内容？</DialogTitle><DialogDescription>切换到“{pending?.name}”会替换当前代码和附加文件，此操作无法撤销。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={onCancel}>保留当前内容</Button><Button onClick={onConfirm}>确认替换</Button></DialogFooter></DialogContent></Dialog>;
}

export function AiCreationDialog({ open, copied, error, onOpenChange, onCopy }: { open: boolean; copied: boolean; error: string | null; onOpenChange: (open: boolean) => void; onCopy: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"><DialogHeader><BotIcon className="mb-2 size-11 rounded-xl bg-secondary p-2.5 text-primary-bright" aria-hidden="true" /><DialogTitle>让 AI 实现你的游戏创意</DialogTitle><DialogDescription>复制一段为 Parti 准备的提示词，交给你常用的 AI，它会先阅读项目文档，再生成完整的房间代码。</DialogDescription></DialogHeader>
      <div className="space-y-4 text-sm"><div className="rounded-xl border border-border bg-surface-2 p-4"><p className="font-semibold text-foreground">AI 会生成这些必需文件</p><div className="mt-2 flex flex-wrap gap-2 font-mono text-xs text-muted-foreground"><span className="rounded-md bg-surface px-2 py-1">parti.room.json</span><span className="rounded-md bg-surface px-2 py-1">index.html</span><span className="rounded-md bg-surface px-2 py-1">room.worker.js</span></div></div><div><p className="font-semibold text-foreground">使用方式</p><ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground"><li>复制提示词并发送给 AI。</li><li>补充玩法、玩家人数、胜负条件和视觉风格。</li><li>检查生成的代码，将三个文件打包为 ZIP，或上传 GitHub 后回到这里导入。</li></ol></div><p className="rounded-lg border border-primary-bright/20 bg-secondary/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">AI 生成的代码仍可能出错。导入前请检查内容，并先通过本地预览验证玩法。</p>{error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</p>}</div>
      <DialogFooter><Button className="w-full sm:w-auto" onClick={onCopy}>{copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}{copied ? '提示词已复制' : '让 AI 帮我创建'}</Button></DialogFooter></DialogContent></Dialog>
  );
}
