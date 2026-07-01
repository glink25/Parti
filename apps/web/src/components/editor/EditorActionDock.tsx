import { ArrowRightIcon, EyeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.js';

export function EditorActionDock({ canCreate, busy, templateBusy, onEdit, onCreate }: { canCreate: boolean; busy: boolean; templateBusy: boolean; onEdit: () => void; onCreate: (target: 'local' | 'peer') => void }) {
  return <div className="fixed bottom-4 left-1/2 z-40 flex w-[min(1240px,calc(100%-48px))] -translate-x-1/2 items-center justify-between gap-6 rounded-[18px] border border-border-strong bg-card/92 px-[18px] py-4 shadow-[0_16px_45px_rgba(91,72,15,0.14)] backdrop-blur-lg max-md:bottom-0 max-md:w-full max-md:items-stretch max-md:rounded-t-[20px] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:px-4 max-md:pt-3 max-md:pb-[calc(12px+env(safe-area-inset-bottom))]">
    <div className="flex flex-col gap-1 max-md:hidden"><b className="text-[15px]">准备好了吗？</b><span className="text-[11px] text-muted-foreground">创建后可继续设置标题、密码和公开状态。</span></div>
    <div className="flex flex-wrap items-center gap-2.5 max-md:w-full max-md:flex-nowrap max-md:[&>*]:min-h-12 max-md:[&>*]:flex-1">{canCreate ? <>{import.meta.env.DEV && <Button variant="outline" disabled={busy} onClick={() => onCreate('local')}><EyeIcon data-icon="inline-start" />本地预览</Button>}<Button size="lg" disabled={busy} onClick={() => onCreate('peer')}>{busy ? '正在创建…' : '创建联机房间'} <ArrowRightIcon data-icon="inline-end" /></Button></> : <Button size="lg" disabled={templateBusy} onClick={onEdit}>继续创建 <ArrowRightIcon data-icon="inline-end" /></Button>}</div>
  </div>;
}
