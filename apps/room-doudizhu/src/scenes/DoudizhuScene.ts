import { mainCanvas, mainContext, mousePosScreen, mouseWasPressed } from 'littlejsengine';
import type { Card, GameState, PlayerState } from '../game/types';

const TABLE = '#0f6b4f';
const PANEL = '#0b2f28';
const GOLD = '#f8c75c';
const WHITE = '#f8fafc';
const MUTED = '#a7c7bd';
const FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type HitRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  onClick: () => void;
};

export class DoudizhuScene {
  private state: GameState | null = null;
  private hand: Card[] = [];
  private selected = new Set<string>();
  private disposers: Array<() => void> = [];
  private hitRegions: HitRegion[] = [];
  private flash = '';
  private flashTimer?: number;
  private pixelRatio = 1;

  init() {
    this.disposers.push(
      parti.onState((state) => {
        this.state = state as GameState;
      }),
      parti.onEvent('hand:update', (payload) => {
        this.hand = (payload as { hand: Card[] }).hand;
        this.selected.clear();
      }),
      parti.onEvent('game:invalid', (payload) => {
        this.showFlash((payload as { message: string }).message);
      }),
      parti.onEvent('game:notice', (payload) => {
        this.showFlash((payload as { message: string }).message);
      }),
    );

    window.addEventListener('pagehide', this.destroy, { once: true });
    parti.ready();
    void parti.action('syncHand');
  }

  update() {
    this.pixelRatio = mainCanvas.width / Math.max(1, mainCanvas.clientWidth);
    const pointerX = mousePosScreen.x / this.pixelRatio;
    const pointerY = mousePosScreen.y / this.pixelRatio;
    const hovered = [...this.hitRegions].reverse().find((hit) => this.contains(hit, pointerX, pointerY));
    mainCanvas.style.cursor = hovered ? 'pointer' : '';

    if (hovered && mouseWasPressed(0)) hovered.onClick();
  }

  render() {
    const width = mainCanvas.width / this.pixelRatio;
    const height = mainCanvas.height / this.pixelRatio;
    const context = mainContext;

    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    this.hitRegions = [];

    this.fillRect(0, 0, width, height, TABLE);
    this.drawVignette(width, height);

    if (!this.state) {
      this.centerText('正在连接房间...', width, height / 2);
      context.restore();
      return;
    }

    this.drawHeader(width);
    this.drawPlayers(width, height);
    this.drawCenterTable(width, height);
    this.drawHand(width, height);
    this.drawActions(width, height);
    this.drawFlash(width, height);
    context.restore();
  }

  private destroy = () => {
    for (const dispose of this.disposers.splice(0)) dispose();
    if (this.flashTimer) window.clearTimeout(this.flashTimer);
  };

  private drawVignette(width: number, height: number) {
    const context = mainContext;
    context.save();
    context.globalAlpha = 0.38;
    context.fillStyle = '#06130f';
    context.beginPath();
    context.ellipse(width / 2, height / 2, width * 0.45, height * 0.38, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.45;
    context.strokeStyle = '#2aa678';
    context.lineWidth = 4;
    context.beginPath();
    context.ellipse(width / 2, height / 2, width * 0.44, height * 0.36, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  private drawHeader(width: number) {
    const state = this.state!;
    const topSafe = 56;
    this.text(24, topSafe, '斗地主', 28, WHITE, 700);
    this.text(24, topSafe + 36, this.phaseText(state), 15, MUTED);

    const scores = this.sortedPlayers().map((player) => `${player.name}: ${player.score}`).join('    ');
    this.wrappedText(24, topSafe + 62, scores || '等待玩家加入...', Math.max(240, width - 160), 14, '#dff8ef');

    if (state.round.multiplier > 1 || state.round.baseScore > 0) {
      this.text(width - 184, topSafe + 60, `底分 ${state.round.baseScore || '-'}  倍数 x${state.round.multiplier}`, 14, '#ffe7a3');
    }
  }

  private drawPlayers(width: number, height: number) {
    const state = this.state!;
    const positions = [
      { x: width / 2, y: height - 142 },
      { x: Math.max(88, width * 0.12), y: height * 0.38 },
      { x: Math.min(width - 164, width * 0.78), y: height * 0.38 },
    ];

    this.playersByVisualSeat().forEach((player, index) => {
      const pos = positions[index];
      if (!player || !pos) return;
      const isMe = player.id === parti.playerId;
      const isTurn = state.currentPlayerId === player.id || state.bidState?.currentPlayerId === player.id;
      const width = index === 0 ? 300 : 220;
      const height = 74;
      const x = pos.x - width / 2;
      const y = pos.y - height / 2;

      this.panel(x, y, width, height, isTurn ? '#1d7d5f' : PANEL, isTurn ? GOLD : '#278262', 0.92);
      this.text(x + 16, y + 12, `${player.name}${isMe ? '（你）' : ''}`, 18, WHITE, 700);
      this.text(x + 16, y + 40, this.playerSubtitle(player), 13, MUTED);

      const count = state.handCounts[player.id];
      if (index !== 0 && typeof count === 'number') this.drawCardBack(x + width - 56, y + 15, 32, 44, String(count));
    });
  }

  private drawCenterTable(width: number, height: number) {
    const state = this.state!;
    const centerY = height * 0.48;

    if (state.landlordCardsVisible.length > 0) {
      this.text(width / 2 - 82, 118, '底牌', 14, MUTED);
      state.landlordCardsVisible.forEach((card, index) => this.drawCard(width / 2 - 42 + index * 38, 144, card, 34, 48));
    }

    if (state.lastPlay) {
      this.text(width / 2 - 120, centerY - 92, `${this.nameOf(state.lastPlay.playerId)} 出牌：${state.lastPlay.analysis.label}`, 16, '#e7fff6');
      this.drawCardsLine(state.lastPlay.cards, width / 2, centerY - 36, Math.min(54, width / 15), Math.min(74, height / 8));
    } else if (state.phase === 'playing') {
      this.centerText('新一轮，等待出牌', width, centerY - 20, 18, MUTED);
    }

    if (state.result) {
      const resultText = state.result.winnerTeam === 'landlord' ? '地主胜利' : '农民胜利';
      this.panel(width / 2 - 180, centerY - 118, 360, 236, '#051f19', GOLD, 0.94);
      this.centerText(resultText, width, centerY - 84, 30, '#ffe7a3', 700);
      const rows = Object.entries(state.result.deltas).map(([id, delta]) => `${this.nameOf(id)} ${delta >= 0 ? '+' : ''}${delta}`);
      this.centerText(rows.join('    '), width, centerY - 34, 18, WHITE);
      this.centerText(`最终倍数 x${state.result.multiplier}${state.result.spring ? ' · 春天' : ''}`, width, centerY + 4, 15, MUTED);
    }
  }

  private drawHand(width: number, height: number) {
    if (this.hand.length === 0) return;
    const cardWidth = Math.max(38, Math.min(74, width / 12));
    const cardHeight = cardWidth * 1.38;
    const overlap = Math.max(24, Math.min(cardWidth * 0.72, (width - 72 - cardWidth) / Math.max(1, this.hand.length - 1)));
    const totalWidth = cardWidth + overlap * (this.hand.length - 1);
    const startX = (width - totalWidth) / 2;
    const y = height - cardHeight - 22;

    this.hand.forEach((card, index) => {
      const selected = this.selected.has(card.id);
      const x = startX + index * overlap;
      const cardY = y - (selected ? 22 : 0);
      this.drawCard(x, cardY, card, cardWidth, cardHeight, selected);
      this.hitRegions.push({
        x,
        y: cardY,
        width: index === this.hand.length - 1 ? cardWidth : overlap,
        height: cardHeight,
        onClick: () => {
          if (this.selected.has(card.id)) this.selected.delete(card.id);
          else this.selected.add(card.id);
        },
      });
    });
  }

  private drawActions(width: number, height: number) {
    const state = this.state!;
    const me = this.me();
    const y = Math.max(132, height - 214);
    if (!me) return;

    if (state.phase === 'waiting') {
      this.centerText('等待三名玩家加入房间', width, y, 20, WHITE);
    } else if (state.phase === 'ready' || state.phase === 'settlement') {
      this.button(width / 2 - 70, y, 140, 46, me.ready ? '取消准备' : '准备', () => void parti.action('setReady', { ready: !me.ready }));
    } else if (state.phase === 'bidding' && state.bidState?.currentPlayerId === me.id) {
      const labels = [{ score: 0, label: '不叫' }, { score: 1, label: '1 分' }, { score: 2, label: '2 分' }, { score: 3, label: '3 分' }];
      labels.forEach((item, index) => this.button(
        width / 2 - 186 + index * 96,
        y,
        82,
        44,
        item.label,
        () => void parti.action('bid', { score: item.score }),
        item.score > 0 && item.score <= state.bidState!.highestScore,
      ));
    } else if (state.phase === 'playing' && state.currentPlayerId === me.id) {
      this.button(width / 2 - 150, y, 120, 44, '出牌', () => void parti.action('playCards', { cardIds: [...this.selected] }), this.selected.size === 0);
      this.button(width / 2 + 30, y, 120, 44, '不出', () => void parti.action('pass'), !state.lastPlay || state.lastPlay.playerId === me.id);
    }
  }

  private drawCardsLine(cards: Card[], centerX: number, y: number, width: number, height: number) {
    const gap = Math.min(width * 0.62, 34);
    const startX = centerX - (width + gap * (cards.length - 1)) / 2;
    cards.forEach((card, index) => this.drawCard(startX + index * gap, y, card, width, height));
  }

  private drawCard(x: number, y: number, card: Card, width: number, height: number, selected = false) {
    const red = card.suit === 'hearts' || card.suit === 'diamonds' || card.suit === 'joker';
    this.panel(x, y, width, height, selected ? '#fff2bf' : '#f8fafc', selected ? GOLD : '#d4e8df');
    this.text(x + 7, y + 6, card.label, Math.max(14, Math.floor(width * 0.34)), red ? '#c0263f' : '#111827', 700);
    this.text(x + 8, y + height - Math.max(20, width * 0.34), this.suitText(card), Math.max(13, Math.floor(width * 0.28)), red ? '#c0263f' : '#111827');
  }

  private drawCardBack(x: number, y: number, width: number, height: number, label: string) {
    this.panel(x, y, width, height, '#b91c1c', '#fecaca');
    this.centeredText(x + width / 2, y + height / 2, label, 16, WHITE, 700);
  }

  private button(x: number, y: number, width: number, height: number, label: string, onClick: () => void, disabled = false) {
    this.panel(x, y, width, height, disabled ? '#38534b' : GOLD, disabled ? '#527166' : '#ffe5a3');
    this.centeredText(x + width / 2, y + height / 2, label, 17, disabled ? '#9fb8af' : '#1f2937', 700);
    if (!disabled) this.hitRegions.push({ x, y, width, height, onClick });
  }

  private drawFlash(width: number, height: number) {
    if (!this.flash) return;
    this.fillRect(width / 2 - 170, height * 0.22, 340, 48, '#111827', 0.88);
    this.centerText(this.flash, width, height * 0.22 + 14, 17, WHITE);
  }

  private showFlash(message: string) {
    this.flash = message;
    if (this.flashTimer) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => { this.flash = ''; }, 1400);
  }

  private panel(x: number, y: number, width: number, height: number, fill: string, stroke: string, alpha = 1) {
    const context = mainContext;
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = fill;
    context.fillRect(x, y, width, height);
    context.globalAlpha = 1;
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.strokeRect(x + 1, y + 1, width - 2, height - 2);
    context.restore();
  }

  private fillRect(x: number, y: number, width: number, height: number, color: string, alpha = 1) {
    const context = mainContext;
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
    context.restore();
  }

  private text(x: number, y: number, value: string, size: number, color: string, weight: number | string = 400) {
    const context = mainContext;
    context.font = `${weight} ${size}px ${FONT_FAMILY}`;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(value, x, y);
  }

  private centeredText(x: number, y: number, value: string, size: number, color: string, weight: number | string = 400) {
    const context = mainContext;
    context.font = `${weight} ${size}px ${FONT_FAMILY}`;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(value, x, y);
  }

  private centerText(value: string, width: number, y: number, size = 22, color = WHITE, weight: number | string = size >= 24 ? 700 : 400) {
    const context = mainContext;
    context.font = `${weight} ${size}px ${FONT_FAMILY}`;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(value, width / 2, y);
  }

  private wrappedText(x: number, y: number, value: string, maxWidth: number, size: number, color: string) {
    const context = mainContext;
    context.font = `400 ${size}px ${FONT_FAMILY}`;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    let line = '';
    let lineY = y;
    for (const character of value) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        context.fillText(line, x, lineY);
        line = character;
        lineY += size * 1.25;
      } else line = candidate;
    }
    if (line) context.fillText(line, x, lineY);
  }

  private contains(hit: HitRegion, x: number, y: number) {
    return x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height;
  }

  private phaseText(state: GameState) {
    if (state.phase === 'waiting') return state.message || '等待玩家加入';
    if (state.phase === 'ready') return '等待所有玩家准备';
    if (state.phase === 'bidding') return `叫地主：当前 ${this.nameOf(state.bidState?.currentPlayerId ?? '')}`;
    if (state.phase === 'playing') return `出牌阶段：轮到 ${this.nameOf(state.currentPlayerId ?? '')}`;
    return '本局结算完成，准备后开始下一局';
  }

  private playerSubtitle(player: PlayerState) {
    const state = this.state!;
    const parts = [`分数 ${player.score}`];
    if (player.role === 'landlord') parts.push('地主');
    if (player.role === 'farmer') parts.push('农民');
    if (state.phase === 'ready' || state.phase === 'settlement') parts.push(player.ready ? '已准备' : '未准备');
    if (!player.connected) parts.push('离线');
    const count = state.handCounts[player.id];
    if (typeof count === 'number' && state.phase !== 'ready') parts.push(`剩 ${count} 张`);
    return parts.join(' · ');
  }

  private suitText(card: Card) {
    if (card.suit === 'spades') return 'S';
    if (card.suit === 'hearts') return 'H';
    if (card.suit === 'clubs') return 'C';
    if (card.suit === 'diamonds') return 'D';
    return card.rank === 17 ? 'BJ' : 'RJ';
  }

  private me() {
    const id = parti.playerId;
    return id && this.state ? this.state.players[id] : null;
  }

  private sortedPlayers() {
    const state = this.state!;
    return state.seats.map((id) => (id ? state.players[id] : null)).filter((player): player is PlayerState => Boolean(player));
  }

  private playersByVisualSeat() {
    const state = this.state!;
    const mySeat = this.me()?.seat ?? 0;
    return [0, 1, 2].map((offset) => {
      const id = state.seats[(mySeat + offset) % 3];
      return id ? state.players[id] : null;
    });
  }

  private nameOf(playerId: string) {
    if (!playerId || !this.state?.players[playerId]) return '...';
    const player = this.state.players[playerId];
    return player.id === parti.playerId ? '你' : player.name;
  }
}
