/**
 * 反馈队列：一次性事件的可视提示（stacked pills，自动过期）。
 * 节点按需创建/移除（纯瞬时提示，不持有交互状态）。
 */

export type FeedbackTone = 'info' | 'good' | 'bad' | 'warn';

interface FeedbackItem {
  el: HTMLDivElement;
  expireAt: number;
}

const TTL_MS = 2600;
const MAX_ITEMS = 4;

export class Feedback {
  private readonly items: FeedbackItem[] = [];

  constructor(private readonly root: HTMLElement) {}

  push(text: string, tone: FeedbackTone = 'info'): void {
    const el = document.createElement('div');
    el.className = `feedback-pill feedback-${tone}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.items.push({ el, expireAt: performance.now() + TTL_MS });
    while (this.items.length > MAX_ITEMS) {
      const oldest = this.items.shift();
      oldest?.el.remove();
    }
    // 触发进入动画
    requestAnimationFrame(() => el.classList.add('show'));
  }

  /** 每帧调用：清理过期项 */
  tick(now: number): void {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const item = this.items[i];
      if (now < item.expireAt) continue;
      item.el.classList.remove('show');
      item.el.classList.add('hide');
      const el = item.el;
      setTimeout(() => el.remove(), 300);
      this.items.splice(i, 1);
    }
  }
}
