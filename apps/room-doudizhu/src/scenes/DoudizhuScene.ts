import Phaser from 'phaser';
import type { Card, GameState, PlayerState } from '../game/types';

const TABLE = 0x0f6b4f;
const PANEL = 0x0b2f28;
const GOLD = 0xf8c75c;
const WHITE = '#f8fafc';
const MUTED = '#a7c7bd';

export class DoudizhuScene extends Phaser.Scene {
  private state: GameState | null = null;
  private hand: Card[] = [];
  private selected = new Set<string>();
  private disposers: Array<() => void> = [];
  private flash = '';
  private flashTimer?: number;

  constructor() {
    super('doudizhu');
  }

  create() {
    this.disposers.push(
      parti.onState((state) => {
        this.state = state as GameState;
        this.render();
      }),
      parti.onEvent('hand:update', (payload) => {
        this.hand = (payload as { hand: Card[] }).hand;
        this.selected.clear();
        this.render();
      }),
      parti.onEvent('game:invalid', (payload) => {
        this.showFlash((payload as { message: string }).message);
      }),
      parti.onEvent('game:notice', (payload) => {
        this.showFlash((payload as { message: string }).message);
      }),
    );

    this.scale.on('resize', this.render, this);
    parti.ready();
    void parti.action('syncHand');
    this.render();
  }

  shutdown() {
    for (const dispose of this.disposers) dispose();
    this.scale.off('resize', this.render, this);
  }

  private render = () => {
    this.children.removeAll(true);

    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, TABLE).setOrigin(0);
    this.drawVignette(width, height);

    if (!this.state) {
      this.centerText('正在连接房间...');
      return;
    }

    this.drawHeader(width);
    this.drawPlayers(width, height);
    this.drawCenterTable(width, height);
    this.drawHand(width, height);
    this.drawActions(width, height);
    this.drawFlash(width, height);
  };

  private drawVignette(width: number, height: number) {
    const g = this.add.graphics();
    g.fillStyle(0x06130f, 0.38);
    g.fillEllipse(width / 2, height / 2, width * 0.9, height * 0.76);
    g.lineStyle(4, 0x2aa678, 0.45);
    g.strokeEllipse(width / 2, height / 2, width * 0.88, height * 0.72);
  }

  private drawHeader(width: number) {
    const state = this.state!;
    const topSafe = 56;
    this.add.text(24, topSafe, '斗地主', {
      fontFamily: 'system-ui',
      fontSize: '28px',
      fontStyle: '700',
      color: WHITE,
    });
    this.add.text(24, topSafe + 36, this.phaseText(state), {
      fontFamily: 'system-ui',
      fontSize: '15px',
      color: MUTED,
    });

    const scores = this.sortedPlayers()
      .map((p) => `${p.name}: ${p.score}`)
      .join('    ');
    this.add
      .text(24, topSafe + 62, scores || '等待玩家加入...', {
        fontFamily: 'system-ui',
        fontSize: '14px',
        color: '#dff8ef',
      })
      .setWordWrapWidth(Math.max(240, width - 160));

    if (state.round.multiplier > 1 || state.round.baseScore > 0) {
      this.add.text(width - 184, topSafe + 60, `底分 ${state.round.baseScore || '-'}  倍数 x${state.round.multiplier}`, {
        fontFamily: 'system-ui',
        fontSize: '14px',
        color: '#ffe7a3',
      });
    }
  }

  private drawPlayers(width: number, height: number) {
    const state = this.state!;
    const ordered = this.playersByVisualSeat();
    const positions = [
      { x: width / 2, y: height - 142, anchor: 'bottom' },
      { x: Math.max(88, width * 0.12), y: height * 0.38, anchor: 'left' },
      { x: Math.min(width - 164, width * 0.78), y: height * 0.38, anchor: 'right' },
    ];

    ordered.forEach((player, index) => {
      const pos = positions[index];
      if (!player || !pos) return;
      const isMe = player.id === parti.playerId;
      const isTurn = state.currentPlayerId === player.id || state.bidState?.currentPlayerId === player.id;
      const w = index === 0 ? 300 : 220;
      const h = 74;
      const x = pos.x - w / 2;
      const y = pos.y - h / 2;

      this.add.rectangle(x, y, w, h, isTurn ? 0x1d7d5f : PANEL, 0.92).setOrigin(0).setStrokeStyle(2, isTurn ? GOLD : 0x278262);
      this.add.text(x + 16, y + 12, `${player.name}${isMe ? '（你）' : ''}`, {
        fontFamily: 'system-ui',
        fontSize: '18px',
        fontStyle: '700',
        color: WHITE,
      });
      this.add.text(x + 16, y + 40, this.playerSubtitle(player), {
        fontFamily: 'system-ui',
        fontSize: '13px',
        color: MUTED,
      });

      const count = state.handCounts[player.id];
      if (index !== 0 && typeof count === 'number') {
        this.drawCardBack(x + w - 56, y + 15, 32, 44, String(count));
      }
    });
  }

  private drawCenterTable(width: number, height: number) {
    const state = this.state!;
    const centerY = height * 0.48;

    if (state.landlordCardsVisible.length > 0) {
      this.add.text(width / 2 - 82, 118, '底牌', {
        fontFamily: 'system-ui',
        fontSize: '14px',
        color: MUTED,
      });
      state.landlordCardsVisible.forEach((card, i) => {
        this.drawCard(width / 2 - 42 + i * 38, 144, card, 34, 48, false);
      });
    }

    if (state.lastPlay) {
      this.add.text(width / 2 - 120, centerY - 92, `${this.nameOf(state.lastPlay.playerId)} 出牌：${state.lastPlay.analysis.label}`, {
        fontFamily: 'system-ui',
        fontSize: '16px',
        color: '#e7fff6',
      });
      this.drawCardsLine(state.lastPlay.cards, width / 2, centerY - 36, Math.min(54, width / 15), Math.min(74, height / 8));
    } else if (state.phase === 'playing') {
      this.centerText('新一轮，等待出牌', centerY - 20, 18, MUTED);
    }

    if (state.result) {
      const text = state.result.winnerTeam === 'landlord' ? '地主胜利' : '农民胜利';
      this.add.rectangle(width / 2 - 180, centerY - 118, 360, 236, 0x051f19, 0.94).setOrigin(0).setStrokeStyle(2, GOLD);
      this.centerText(text, centerY - 84, 30, '#ffe7a3');
      const rows = Object.entries(state.result.deltas).map(([id, delta]) => `${this.nameOf(id)} ${delta >= 0 ? '+' : ''}${delta}`);
      this.centerText(rows.join('    '), centerY - 34, 18, WHITE);
      this.centerText(`最终倍数 x${state.result.multiplier}${state.result.spring ? ' · 春天' : ''}`, centerY + 4, 15, MUTED);
    }
  }

  private drawHand(width: number, height: number) {
    if (this.hand.length === 0) return;
    const cardW = Math.max(38, Math.min(74, width / 12));
    const cardH = cardW * 1.38;
    const overlap = Math.max(24, Math.min(cardW * 0.72, (width - 72 - cardW) / Math.max(1, this.hand.length - 1)));
    const totalW = cardW + overlap * (this.hand.length - 1);
    const startX = (width - totalW) / 2;
    const y = height - cardH - 22;

    this.hand.forEach((card, index) => {
      const selected = this.selected.has(card.id);
      const x = startX + index * overlap;
      const cardY = y - (selected ? 22 : 0);
      const hit = this.drawCard(x, cardY, card, cardW, cardH, selected);
      hit.on('pointerdown', () => {
        if (this.selected.has(card.id)) this.selected.delete(card.id);
        else this.selected.add(card.id);
        this.render();
      });
    });
  }

  private drawActions(width: number, height: number) {
    const state = this.state!;
    const me = this.me();
    const y = Math.max(132, height - 214);

    if (!me) return;

    if (state.phase === 'waiting') {
      this.centerText('等待三名玩家加入房间', y, 20, WHITE);
      return;
    }

    if (state.phase === 'ready' || state.phase === 'settlement') {
      this.button(width / 2 - 70, y, 140, 46, me.ready ? '取消准备' : '准备', () => {
        void parti.action('setReady', { ready: !me.ready });
      });
      return;
    }

    if (state.phase === 'bidding' && state.bidState?.currentPlayerId === me.id) {
      const labels = [
        { score: 0, label: '不叫' },
        { score: 1, label: '1 分' },
        { score: 2, label: '2 分' },
        { score: 3, label: '3 分' },
      ];
      labels.forEach((item, i) => {
        const disabled = item.score > 0 && item.score <= state.bidState!.highestScore;
        this.button(width / 2 - 186 + i * 96, y, 82, 44, item.label, () => {
          void parti.action('bid', { score: item.score });
        }, disabled);
      });
      return;
    }

    if (state.phase === 'playing' && state.currentPlayerId === me.id) {
      this.button(width / 2 - 150, y, 120, 44, '出牌', () => {
        void parti.action('playCards', { cardIds: [...this.selected] });
      }, this.selected.size === 0);
      this.button(width / 2 + 30, y, 120, 44, '不出', () => {
        void parti.action('pass');
      }, !state.lastPlay || state.lastPlay.playerId === me.id);
    }
  }

  private drawCardsLine(cards: Card[], centerX: number, y: number, cardW: number, cardH: number) {
    const gap = Math.min(cardW * 0.62, 34);
    const total = cardW + gap * (cards.length - 1);
    const startX = centerX - total / 2;
    cards.forEach((card, i) => this.drawCard(startX + i * gap, y, card, cardW, cardH, false));
  }

  private drawCard(x: number, y: number, card: Card, w: number, h: number, selected: boolean) {
    const red = card.suit === 'hearts' || card.suit === 'diamonds' || card.suit === 'joker';
    const rect = this.add.rectangle(x, y, w, h, selected ? 0xfff2bf : 0xf8fafc).setOrigin(0).setStrokeStyle(2, selected ? GOLD : 0xd4e8df);
    rect.setInteractive({ useHandCursor: true });
    this.add.text(x + 7, y + 6, card.label, {
      fontFamily: 'system-ui',
      fontSize: `${Math.max(14, Math.floor(w * 0.34))}px`,
      fontStyle: '700',
      color: red ? '#c0263f' : '#111827',
    });
    this.add.text(x + 8, y + h - Math.max(20, w * 0.34), this.suitText(card), {
      fontFamily: 'system-ui',
      fontSize: `${Math.max(13, Math.floor(w * 0.28))}px`,
      color: red ? '#c0263f' : '#111827',
    });
    return rect;
  }

  private drawCardBack(x: number, y: number, w: number, h: number, label: string) {
    this.add.rectangle(x, y, w, h, 0xb91c1c).setOrigin(0).setStrokeStyle(2, 0xfecaca);
    this.add.text(x + w / 2, y + h / 2, label, {
      fontFamily: 'system-ui',
      fontSize: '16px',
      fontStyle: '700',
      color: WHITE,
    }).setOrigin(0.5);
  }

  private button(x: number, y: number, w: number, h: number, label: string, onClick: () => void, disabled = false) {
    const fill = disabled ? 0x38534b : 0xf8c75c;
    const textColor = disabled ? '#9fb8af' : '#1f2937';
    const rect = this.add.rectangle(x, y, w, h, fill).setOrigin(0).setStrokeStyle(2, disabled ? 0x527166 : 0xffe5a3);
    if (!disabled) rect.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    this.add.text(x + w / 2, y + h / 2, label, {
      fontFamily: 'system-ui',
      fontSize: '17px',
      fontStyle: '700',
      color: textColor,
    }).setOrigin(0.5);
  }

  private drawFlash(width: number, height: number) {
    if (!this.flash) return;
    this.add.rectangle(width / 2 - 170, height * 0.22, 340, 48, 0x111827, 0.88).setOrigin(0);
    this.centerText(this.flash, height * 0.22 + 14, 17, WHITE);
  }

  private showFlash(message: string) {
    this.flash = message;
    if (this.flashTimer) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flash = '';
      this.render();
    }, 1400);
    this.render();
  }

  private centerText(text: string, y = this.scale.height / 2, size = 22, color = WHITE) {
    this.add.text(this.scale.width / 2, y, text, {
      fontFamily: 'system-ui',
      fontSize: `${size}px`,
      fontStyle: size >= 24 ? '700' : '400',
      color,
      align: 'center',
    }).setOrigin(0.5, 0);
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
    return state.seats.map((id) => (id ? state.players[id] : null)).filter((p): p is PlayerState => Boolean(p));
  }

  private playersByVisualSeat() {
    const state = this.state!;
    const mySeat = this.me()?.seat ?? 0;
    return [0, 1, 2].map((offset) => {
      const seat = (mySeat + offset) % 3;
      const id = state.seats[seat];
      return id ? state.players[id] : null;
    });
  }

  private nameOf(playerId: string) {
    if (!playerId || !this.state?.players[playerId]) return '...';
    const player = this.state.players[playerId];
    return player.id === parti.playerId ? '你' : player.name;
  }
}
