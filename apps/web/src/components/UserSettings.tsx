import { useState } from 'react';
import { UserRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet.js';
import {
  MAX_USER_NAME_LENGTH,
  saveLocalUserName,
  type LocalUser,
} from '../lib/localUser.js';

export function UserSettings({ user, onChange }: { user: LocalUser; onChange: (user: LocalUser) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(user.name);
  const [message, setMessage] = useState<string | null>(null);

  function setSheetOpen(next: boolean): void {
    setOpen(next);
    if (next) {
      setDraft(user.name);
      setMessage(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" className="ml-auto max-w-[210px] gap-2 px-2.5 text-muted-foreground hover:text-foreground" aria-label={`用户设置：${user.name}`}>
          <UserRoundIcon />
          <span className="hidden truncate sm:inline">{user.name}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>用户设置</SheetTitle>
          <SheetDescription>这个身份保存在当前浏览器中，并用于创建或加入房间。</SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-6 px-4 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const next = saveLocalUserName(draft);
              onChange(next);
              setDraft(next.name);
              setMessage('已保存，将在下次进入或重连房间时生效。');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="parti-user-name">用户名</Label>
            <Input id="parti-user-name" value={draft} maxLength={MAX_USER_NAME_LENGTH} autoComplete="nickname" onChange={(event) => setDraft(event.target.value)} />
            <p className="text-xs text-muted-foreground">朋友会在房间中通过这个名称认出你。</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="parti-user-id">用户 ID</Label>
            <Input id="parti-user-id" value={user.id} readOnly className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">首次访问时生成，不会因改名或退出房间而改变。</p>
          </div>
          <div className="mt-auto grid gap-3">
            {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
            <Button type="submit">保存用户名</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
