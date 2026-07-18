/**
 * HUD：发射按钮（带倒计时环）、事件/轮次指示、提示文案。
 * 节点创建一次，之后只更新 textContent/class/style，不重建。
 */

import type { ActiveEvent, EventKind } from '../../shared/protocol';

export const EVENT_TEXT: Record<EventKind, string> = {
  speed_up: '烈酒加速',
  reverse: '酒馆反转',
  heal_zone: '暖炉祝福',
  slow_zone: '冰镇时刻',
  wide_zone: '笨重镖区',
  multishot_zone: '三镖罚单',
};

export interface HudView {
  playing: boolean;
  canShoot: boolean;
  /** 剩余毫秒；null 表示重对齐中（显示 ···） */
  timerMs: number | null;
  durationMs: number;
  committed: number;
  required: number;
  round: number;
  event: ActiveEvent | null;
  isMyTurn: boolean;
  currentPlayerName: string;
  phase: string;
}

const RING_R = 44;
const RING_LEN = 2 * Math.PI * RING_R;

export class Hud {
  private readonly fireButton: HTMLButtonElement;
  private readonly fireLabel: HTMLSpanElement;
  private readonly ringFg: SVGCircleElement;
  private readonly timerText: HTMLDivElement;
  private readonly shotsText: HTMLDivElement;
  private readonly turnHint: HTMLDivElement;
  private readonly eventPill: HTMLDivElement;
  private readonly roundPill: HTMLDivElement;
  private readonly container: HTMLDivElement;

  constructor(root: HTMLElement, onFire: () => void) {
    this.container = document.createElement('div');
    this.container.id = 'hud';

    const topBar = document.createElement('div');
    topBar.id = 'top-bar';
    this.eventPill = document.createElement('div');
    this.eventPill.id = 'event-pill';
    this.roundPill = document.createElement('div');
    this.roundPill.id = 'round-pill';
    topBar.append(this.eventPill, this.roundPill);

    const fireArea = document.createElement('div');
    fireArea.id = 'fire-area';

    this.shotsText = document.createElement('div');
    this.shotsText.id = 'shots-indicator';

    this.fireButton = document.createElement('button');
    this.fireButton.id = 'fire-button';
    this.fireButton.type = 'button';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('fire-ring');
    const ringBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ringBg.setAttribute('cx', '50');
    ringBg.setAttribute('cy', '50');
    ringBg.setAttribute('r', String(RING_R));
    ringBg.classList.add('ring-bg');
    this.ringFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.ringFg.setAttribute('cx', '50');
    this.ringFg.setAttribute('cy', '50');
    this.ringFg.setAttribute('r', String(RING_R));
    this.ringFg.classList.add('ring-fg');
    this.ringFg.style.strokeDasharray = String(RING_LEN);
    this.ringFg.style.strokeDashoffset = '0';
    svg.append(ringBg, this.ringFg);
    this.fireLabel = document.createElement('span');
    this.fireLabel.id = 'fire-label';
    this.fireLabel.textContent = '发射';
    this.fireButton.append(svg, this.fireLabel);
    this.fireButton.addEventListener('click', onFire);

    this.timerText = document.createElement('div');
    this.timerText.id = 'timer-text';

    this.turnHint = document.createElement('div');
    this.turnHint.id = 'turn-hint';

    fireArea.append(this.shotsText, this.fireButton, this.timerText, this.turnHint);
    this.container.append(topBar, fireArea);
    root.appendChild(this.container);
  }

  update(view: HudView): void {
    this.container.classList.toggle('hidden', !view.playing);
    if (!view.playing) return;

    // 事件 / 轮次
    this.eventPill.hidden = !view.event;
    if (view.event) {
      this.eventPill.textContent = EVENT_TEXT[view.event.kind];
      this.eventPill.dataset.kind = view.event.kind;
    }
    this.roundPill.textContent = `第 ${view.round} 轮`;

    // 倒计时
    if (view.timerMs === null) {
      this.timerText.textContent = '···';
      this.setRing(1);
    } else {
      this.timerText.textContent = (view.timerMs / 1000).toFixed(1);
      this.setRing(view.durationMs > 0 ? view.timerMs / view.durationMs : 0);
      this.timerText.classList.toggle('urgent', view.timerMs < 3000);
    }

    // 镖数
    this.shotsText.textContent =
      view.required > 1 ? `本回合 ${view.committed}/${view.required} 镖` : '';

    // 发射按钮
    this.fireButton.disabled = !view.canShoot;
    this.fireButton.classList.toggle('armed', view.canShoot);
    this.fireLabel.textContent = view.canShoot ? '发射' : '待命中';

    // 提示
    if (view.phase === 'aligning' || view.phase === 'recovering') {
      this.turnHint.textContent = view.phase === 'recovering' ? '同步中…' : '瞄准就绪中…';
    } else if (view.isMyTurn) {
      this.turnHint.textContent = view.phase === 'flying' ? '镖已离手…' : view.phase === 'done' ? '回合结束' : '轮到你出手了！';
    } else {
      this.turnHint.textContent = `等待 ${view.currentPlayerName} 出手`;
    }
  }

  private setRing(fraction: number): void {
    const f = Math.max(0, Math.min(1, fraction));
    this.ringFg.style.strokeDashoffset = String(RING_LEN * (1 - f));
  }
}
