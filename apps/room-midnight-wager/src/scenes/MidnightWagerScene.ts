import { mainCanvas, mainContext, mousePosScreen, mouseWasPressed, Sound } from 'littlejsengine';
import type { Card, GameState, PlayerState, Ruleset } from '../game/types';
import { easeInOutCubic, MidnightWagerAnimationQueue, type WagerAnimation } from './MidnightWagerAnimationQueue';
import { wagerPresentationMask } from './MidnightWagerPresentation';

const INK = '#f1e8da';
const MUTED = '#a5988d';
const BLOOD_BRIGHT = '#d14149';
const GOLD = '#c79a54';
const TABLE = '#241516';
const BLACK = '#090607';
const FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

type HitRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  onClick: () => void;
};

const RULE_NAMES: Record<Ruleset, string> = {
  classic: '经典局',
  devil: '恶魔局',
  chaos: '混沌局',
};

const RULE_COPY: Record<Ruleset, string> = {
  classic: '每次暗出 1–3 张。相信上一手，或当场揭穿谎言。',
  devil: '恶魔牌必须单独打出；桌上四张牌后可以发动恶魔交易。',
  chaos: '每次只出一张。主宰选择目标，混沌让所有人同时开枪。',
};

const RULE_DETAILS: Record<Ruleset, string[]> = {
  classic: [
    'A、K、Q 各六张，加两张万能牌；每名玩家拿五张。',
    '每次暗出一至三张。非桌面点数且非万能牌，就算撒谎。',
    '下一位可以继续出牌或质疑；空手跳过，只剩一人持牌时必须质疑。',
    '撒谎者或误判者对自己扣动扳机；存活后重新发牌，由受罚者开始。',
  ],
  devil: [
    '继承经典规则。每个点数都有一张带恶魔印记的牌。',
    '至少三人生还时，当前桌面点数的恶魔牌生效，而且必须单独打出。',
    '恶魔牌被质疑后，除出牌者外仍持牌的玩家分别对自己扣动扳机。',
    '轮到你且桌面至少四张时可发动恶魔交易：最近四张全是谎牌则全桌受罚，否则你受罚。',
  ],
  chaos: [
    '五张 K、五张 Q、一张主宰、一张混沌；每人三张，每次只出一张。',
    '质疑成功时，质疑者只能射击撒谎者；质疑失败则对自己扣动扳机并重新发牌。',
    '主宰被揭示时，由出牌者选择一名生还对手射击。',
    '混沌牌打出后立即公开；所有生还玩家秘密选目标，收齐后同时结算。',
    '成功质疑和特殊牌结算保留手牌；不足两人持牌时才重新发牌。',
  ],
};

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameState>;
  return (
    candidate.version === 1 &&
    typeof candidate.players === 'object' &&
    candidate.players !== null &&
    Array.isArray(candidate.seats) &&
    typeof candidate.phase === 'string'
  );
}

export class MidnightWagerScene {
  private state: GameState | null = null;
  private hand: Card[] = [];
  private selectedCards = new Set<string>();
  private selectedTarget: string | null = null;
  private hitRegions: HitRegion[] = [];
  private disposers: Array<() => void> = [];
  private pixelRatio = 1;
  private flash = '';
  private flashUntil = 0;
  private soundEnabled = true;
  private rulesOpen = false;
  private shakeUntil = 0;
  private impactUntil = 0;
  private lastPhase = '';
  private lastRound = -1;
  private animations = new MidnightWagerAnimationQueue();
  private activeAnimation:(WagerAnimation&{progress:number})|null=null;

  private cardSound = new Sound([0.35, 0.04, 260, 0.01, 0.03, 0.08, 2, 1.8, -8]);
  private revealSound = new Sound([0.45, 0.03, 120, 0.02, 0.08, 0.18, 1, 0.7, -3]);
  private dryFireSound = new Sound([0.45, 0, 75, 0.01, 0.02, 0.06, 4, 0.4]);
  private gunshotSound = new Sound([0.9, 0.05, 80, 0, 0.08, 0.35, 4, 2.8, -12, 0, 0, 0, 0.08]);

  init() {
    this.disposers.push(
      parti.onState((value) => {
        if (!isGameState(value)) return;
        const state = value;
        if (state.phase !== this.lastPhase || state.round !== this.lastRound) {
          this.selectedCards.clear();
          this.selectedTarget = null;
          this.lastPhase = state.phase;
          this.lastRound = state.round;
        }
        this.state = state;
      }),
      parti.onEvent('private:hand', (payload) => {
        this.hand = payload.hand ?? [];
        this.selectedCards.clear();
      }),
      parti.onEvent('game:invalid', (payload) => {
        this.showFlash(payload.message || '操作被拒绝');
      }),
      parti.onEvent('game:notice', (payload) => {
        this.showFlash(payload.message || '牌桌有了动静');
      }),
      parti.onEvent('game:reveal', () => this.playSound(this.revealSound, 0.7)),
      parti.onEvent('game:shots', (payload) => {
        const shots = payload.shots ?? [];
        if (shots.some((shot) => shot.lethal)) {
          this.playSound(this.gunshotSound, 0.9);
          this.shakeUntil = performance.now() + 520;
          this.impactUntil = performance.now() + 360;
        } else {
          this.playSound(this.dryFireSound, 0.8);
        }
      }),
      parti.onEvent('game:action', (payload) => this.receiveAction(payload)),
    );
    window.addEventListener('pagehide', this.destroy, { once: true });
    document.addEventListener('visibilitychange', this.visibility);
    // AI agent 转述：本玩家视角，读 this.state + this.hand。迁移自旧 worker describe()/wagerObserve()。
    parti.exposeToAgent?.(() => buildWagerGuide(this.state, this.hand, parti.playerId));
    parti.ready();
    void parti.action('syncPrivate');
  }

  update() {
    this.pixelRatio = mainCanvas.width / Math.max(1, mainCanvas.clientWidth);
    const pointerX = mousePosScreen.x / this.pixelRatio;
    const pointerY = mousePosScreen.y / this.pixelRatio;
    const hovered = [...this.hitRegions].reverse().find((hit) => this.contains(hit, pointerX, pointerY));
    mainCanvas.style.cursor = hovered ? 'pointer' : '';
    this.activeAnimation=this.animations.update(performance.now());
    if (hovered && mouseWasPressed(0) && !this.animations.isInputBlocked()) hovered.onClick();
    if (this.flash && performance.now() >= this.flashUntil) this.flash = '';
  }

  render() {
    const width = mainCanvas.width / this.pixelRatio;
    const height = mainCanvas.height / this.pixelRatio;
    const context = mainContext;
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    this.hitRegions = [];

    const shaking = performance.now() < this.shakeUntil;
    if (shaking) {
      const time = performance.now();
      context.translate(Math.sin(time * 0.09) * 7, Math.cos(time * 0.13) * 5);
    }
    this.drawRoom(width, height);

    if (!this.state) {
      this.centerText(width / 2, height / 2, '正在推开酒馆的门…', 22, INK, 600);
      context.restore();
      return;
    }

    if (this.state.phase === 'lobby') {
      this.drawHeader(width);
      this.drawLobby(width, height);
    } else {
      this.drawTable(width, height);
      this.drawHeader(width);
    }
    this.drawAnimation(width, height);
    this.drawImpactFlash(width, height);
    if (this.rulesOpen) this.drawRulesOverlay(width, height);
    this.drawFlash(width, height);
    context.restore();
  }

  private destroy = () => {
    for (const dispose of this.disposers.splice(0)) dispose();
    document.removeEventListener('visibilitychange', this.visibility);
  };

  private visibility = () => { if (document.hidden) this.animations.skipToLatest(); };

  private receiveAction(payload: unknown) {
    const event = payload as Partial<WagerAnimation> & { actionId?: string };
    if (!event.actionId || !event.kind) return;
    const major = event.kind === 'reveal' || event.kind === 'shots' || event.kind === 'specialResolved' || event.kind === 'roundSettled';
    this.animations.enqueue({ ...event, id: event.actionId, kind: event.kind, duration: event.kind === 'shots' ? 1250 : major ? 1000 : 520, blocking: major || event.kind === 'cardsCommitted' } as WagerAnimation);
  }

  private drawRoom(width: number, height: number) {
    const context = mainContext;
    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#070506');
    background.addColorStop(0.52, '#1a0e10');
    background.addColorStop(1, '#050405');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.save();
    context.globalAlpha = 0.17;
    const beam = context.createRadialGradient(width / 2, -height * 0.15, 30, width / 2, 0, height * 0.9);
    beam.addColorStop(0, '#e1a95f');
    beam.addColorStop(0.35, '#6f3028');
    beam.addColorStop(1, 'transparent');
    context.fillStyle = beam;
    context.fillRect(0, 0, width, height);
    context.restore();

    context.save();
    const smokeTime = performance.now() / 1000;
    context.fillStyle = '#cbb8aa';
    for (let index = 0; index < 9; index += 1) {
      const drift = Math.sin(smokeTime * (0.16 + index * 0.01) + index * 2.1);
      const x = width * ((index + 0.45) / 9) + drift * 42;
      const y = height * (0.16 + (index % 4) * 0.17) - ((smokeTime * (7 + index)) % 80);
      context.globalAlpha = 0.018 + (index % 3) * 0.008;
      context.beginPath();
      context.ellipse(x, y, 54 + index * 5, 18 + (index % 3) * 7, drift * 0.2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.globalAlpha = 0.09;
    context.strokeStyle = '#d7c0a3';
    for (let x = -height; x < width + height; x += 72) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + height * 0.35, height);
      context.stroke();
    }
    context.restore();
  }

  private drawHeader(width: number) {
    const state = this.state!;
    this.text(18, 14, '午夜赌局', 22, INK, 800);
    this.text(18, 42, `${RULE_NAMES[state.ruleset]} · ${state.message}`, 13, MUTED, 500);
    this.button(18, 67, 70, 28, this.soundEnabled ? '声音 开' : '声音 关', () => {
      this.soundEnabled = !this.soundEnabled;
    }, false, 'quiet');
    this.button(96, 67, 70, 28, '规则', () => {
      this.rulesOpen = true;
    }, false, 'quiet');

    if (state.phase !== 'lobby' && state.phase !== 'finished' && parti.playerId === state.hostId) {
      this.button(Math.max(104, width - 198), 67, 80, 28, '中止牌局', () => void parti.action('abortMatch'), false, 'danger');
    }
  }

  private drawLobby(width: number, height: number) {
    const state = this.state!;
    const compact = width < 720 || height < 620;
    const titleY = compact ? 116 : 135;
    this.centerText(width / 2, titleY, '谎言入席，真相上膛', compact ? 25 : 34, INK, 800);
    this.centerText(width / 2, titleY + 42, '2–4 人 · 最后一名生还者获胜', 14, MUTED, 500);

    const seated = state.seats.map((id) => (id ? state.players[id] : null));
    const cardWidth = Math.min(150, (width - 48) / 4 - 8);
    const rowY = titleY + (compact ? 72 : 88);
    seated.forEach((player, index) => {
      const x = 24 + index * ((width - 48) / 4);
      this.panel(x, rowY, cardWidth, 78, player ? '#201619' : '#110d0f', player?.ready ? GOLD : '#4f3939', 0.95);
      this.centerText(x + cardWidth / 2, rowY + 23, player?.name ?? '空席', 15, player ? INK : '#6d6260', 700);
      this.centerText(
        x + cardWidth / 2,
        rowY + 52,
        player ? (player.ready ? '已准备' : player.connected ? '未准备' : '断线') : '等待入座',
        12,
        player?.ready ? GOLD : MUTED,
        500,
      );
    });

    const rulesY = rowY + 104;
    const gap = 10;
    const modeWidth = Math.min(190, (width - 48 - gap * 2) / 3);
    const modes: Ruleset[] = ['classic', 'devil', 'chaos'];
    const startX = (width - (modeWidth * 3 + gap * 2)) / 2;
    modes.forEach((mode, index) => {
      const x = startX + index * (modeWidth + gap);
      const selected = state.ruleset === mode;
      this.panel(x, rulesY, modeWidth, compact ? 74 : 92, selected ? '#382022' : '#171113', selected ? GOLD : '#4d3738');
      this.centerText(x + modeWidth / 2, rulesY + 24, RULE_NAMES[mode], 16, selected ? '#ffe0a8' : INK, 800);
      if (!compact) this.wrappedText(x + 12, rulesY + 47, RULE_COPY[mode], modeWidth - 24, 11, MUTED, 2);
      if (parti.playerId === state.hostId) {
        this.hitRegions.push({ x, y: rulesY, width: modeWidth, height: compact ? 74 : 92, onClick: () => void parti.action('setRuleset', { ruleset: mode }) });
      }
    });

    const me = this.me();
    const readyY = Math.min(height - 70, rulesY + (compact ? 92 : 116));
    if (me) {
      this.button(
        width / 2 - 78,
        readyY,
        156,
        46,
        me.ready ? '取消准备' : '落座准备',
        () => void parti.action('setReady', { ready: !me.ready }),
        false,
        me.ready ? 'quiet' : 'gold',
      );
    }
  }

  private drawTable(width: number, height: number) {
    const state = this.state!;
    const tableY = height * 0.49;
    const tableWidth = Math.min(width * 0.88, 920);
    const tableHeight = Math.min(height * 0.52, 410);
    const context = mainContext;
    context.save();
    const tableGlow = context.createRadialGradient(width / 2, tableY - 40, 20, width / 2, tableY, tableWidth * 0.52);
    tableGlow.addColorStop(0, '#4b2628');
    tableGlow.addColorStop(0.68, TABLE);
    tableGlow.addColorStop(1, '#100b0c');
    context.fillStyle = tableGlow;
    context.strokeStyle = '#5c3b34';
    context.lineWidth = 7;
    context.beginPath();
    context.ellipse(width / 2, tableY, tableWidth / 2, tableHeight / 2, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();

    this.drawPlayers(width, height, tableY, tableWidth, tableHeight);
    this.drawCenter(width, tableY);
    this.drawHand(width, height);
    this.drawActions(width, height);

    if (state.phase === 'roulette') this.drawRoulette(width, height);
    if (state.phase === 'resolution') this.drawResolution(width, height);
    if (state.phase === 'finished'&&!wagerPresentationMask(this.activeAnimation,this.animations.presentationAnimations()).hiddenFinished) this.drawFinished(width, height);
  }

  private drawPlayers(width: number, _height: number, tableY: number, tableWidth: number, tableHeight: number) {
    const state = this.state!;
    const me = this.me();
    const alivePlayers = state.seats
      .map((id) => (id ? state.players[id] : null))
      .filter((player): player is PlayerState => Boolean(player));
    const visual = alivePlayers.filter((player) => player.id !== parti.playerId);
    visual.sort((a, b) => {
      if (!me) return a.seat - b.seat;
      return ((a.seat - me.seat + 4) % 4) - ((b.seat - me.seat + 4) % 4);
    });
    const positions =
      visual.length === 1
        ? [{ x: width / 2, y: tableY - tableHeight * 0.63 }]
        : visual.length === 2
          ? [
              { x: width / 2 - tableWidth * 0.27, y: tableY - tableHeight * 0.52 },
              { x: width / 2 + tableWidth * 0.27, y: tableY - tableHeight * 0.52 },
            ]
          : [
              { x: width / 2 - tableWidth * 0.34, y: tableY - tableHeight * 0.34 },
              { x: width / 2, y: tableY - tableHeight * 0.62 },
              { x: width / 2 + tableWidth * 0.34, y: tableY - tableHeight * 0.34 },
            ];
    visual.forEach((player, index) => this.drawPlayer(player, positions[index].x, positions[index].y));
  }

  private drawPlayer(player: PlayerState, x: number, y: number) {
    const state = this.state!;
    const current = state.currentPlayerId === player.id;
    const targetable = this.canTarget(player.id);
    const selected = this.selectedTarget === player.id;
    const visuallyAlive=player.alive||wagerPresentationMask(this.activeAnimation,this.animations.presentationAnimations()).deferredLethalTargets.has(player.id);
    mainContext.save();
    mainContext.globalAlpha = visuallyAlive ? 1 : 0.3;
    if (!visuallyAlive) {
      mainContext.translate(x, y + 12);
      mainContext.rotate(-0.92);
      mainContext.translate(-x, -y);
    }
    mainContext.fillStyle = selected ? BLOOD_BRIGHT : current ? GOLD : '#171113';
    mainContext.strokeStyle = targetable ? '#f0b15e' : '#5a4442';
    mainContext.lineWidth = current || selected ? 4 : 2;
    mainContext.beginPath();
    mainContext.arc(x, y - 22, 22, 0, Math.PI * 2);
    mainContext.fill();
    mainContext.stroke();
    mainContext.beginPath();
    mainContext.ellipse(x, y + 18, 43, 28, 0, Math.PI, Math.PI * 2);
    mainContext.fill();
    mainContext.stroke();
    mainContext.restore();
    this.centerText(x, y + 35, player.name, 13, visuallyAlive ? INK : '#776967', 700);
    this.centerText(
      x,
      y + 53,
      visuallyAlive ? `${player.handCount} 张 · ${player.safePulls}/6${player.connected ? '' : ' · 断线'}` : '已出局',
      11,
      current ? GOLD : MUTED,
      500,
    );
  }

  private drawCenter(width: number, tableY: number) {
    const state = this.state!;
    const mask=wagerPresentationMask(this.activeAnimation,this.animations.presentationAnimations());
    this.centerText(width / 2, tableY - 72, state.tableRank ? `${state.tableRank} 桌` : '等待开桌', 28, '#f0c47f', 900);
    this.centerText(width / 2, tableY - 39, `第 ${state.round} 轮 · 桌面 ${state.pileCount} 张`, 12, MUTED, 500);
    const count = Math.min(6, Math.max(0, state.pileCount-mask.hiddenPileCount));
    for (let index = 0; index < count; index += 1) {
      this.drawCardBack(width / 2 - 32 + index * 3, tableY - 16 + index * 2, 64, 90);
    }
    if (state.lastPlay) {
      this.centerText(
        width / 2,
        tableY + 88,
        `${this.nameOf(state.lastPlay.playerId)} 声称打出 ${state.lastPlay.count} 张 ${state.tableRank}`,
        13,
        INK,
        600,
      );
    }
  }

  private drawHand(width: number, height: number) {
    const state = this.state!;
    const me = this.me();
    if (!me || !me.alive || state.phase === 'finished') return;
    const cardWidth = Math.max(46, Math.min(72, width / 8));
    const cardHeight = cardWidth * 1.42;
    const gap = Math.min(cardWidth * 0.72, Math.max(28, (width - cardWidth - 30) / Math.max(1, this.hand.length - 1)));
    const totalWidth = cardWidth + gap * Math.max(0, this.hand.length - 1);
    const startX = width / 2 - totalWidth / 2;
    const y = height - cardHeight - 14;
    this.centerText(width / 2, y - 18, `你的手牌 · 左轮 ${me.safePulls}/6`, 11, MUTED, 600);
    this.hand.forEach((card, index) => {
      const selected = this.selectedCards.has(card.id);
      const x = startX + index * gap;
      const drawY = y - (selected ? 16 : 0);
      this.drawCard(x, drawY, card, cardWidth, cardHeight, selected);
      if (state.phase === 'playing' && state.currentPlayerId === parti.playerId) {
        this.hitRegions.push({ x, y: drawY, width: cardWidth, height: cardHeight, onClick: () => this.toggleCard(card.id) });
      }
    });
  }

  private drawActions(width: number, height: number) {
    const state = this.state!;
    const me = this.me();
    if (!me || !me.alive || state.phase !== 'playing') return;
    const y = Math.max(102, height - 192);
    if (state.currentPlayerId !== parti.playerId) {
      this.centerText(width / 2, y + 18, `等待 ${this.nameOf(state.currentPlayerId)} 行动…`, 15, MUTED, 600);
      return;
    }

    const holders = Object.values(state.players).filter((player) => player.alive && player.handCount > 0);
    const forcedChallenge = state.pileCount > 0 && holders.length === 1 && holders[0].id === parti.playerId;
    const actions: Array<{ label: string; onClick: () => void; disabled?: boolean; style?: 'gold' | 'danger' | 'quiet' }> = [
      {
        label: this.selectedCards.size ? `暗出 ${this.selectedCards.size} 张` : '选择手牌',
        onClick: () => void parti.action('playCards', { cardIds: [...this.selectedCards] }),
        disabled: this.selectedCards.size === 0 || forcedChallenge,
        style: 'gold',
      },
    ];
    if (state.lastPlay) {
      actions.push({ label: forcedChallenge ? '必须质疑' : '骗子！', onClick: () => void parti.action('callLiar'), style: 'danger' });
    }
    if (state.ruleset === 'devil') {
      actions.push({ label: '恶魔交易', onClick: () => void parti.action('callDevilsDeal'), disabled: state.pileCount < 4, style: 'quiet' });
    }
    const buttonWidth = Math.min(148, (width - 36 - (actions.length - 1) * 8) / actions.length);
    const total = buttonWidth * actions.length + 8 * (actions.length - 1);
    actions.forEach((action, index) => {
      this.button(width / 2 - total / 2 + index * (buttonWidth + 8), y, buttonWidth, 42, action.label, action.onClick, action.disabled, action.style);
    });
  }

  private drawRoulette(width: number, height: number) {
    const state = this.state!;
    const roulette = state.roulette!;
    const me = this.me();
    const isShooter = Boolean(me && roulette.shooterIds.includes(me.id));
    const committed = Boolean(me && roulette.committed.includes(me.id));
    this.scrim(width, height, 0.82);
    const centerX = width / 2;
    const centerY = height * 0.47;
    const radius = Math.min(92, width * 0.15, height * 0.13);
    const revealY = Math.max(112, centerY - radius - 82);
    this.centerText(centerX, revealY - 20, this.rouletteTitle(), 25, INK, 900);
    this.drawRevealedCards(centerX, revealY);
    this.drawRevolver(centerX, centerY, radius);

    if (!isShooter) {
      this.centerText(centerX, centerY + 132, '有人正把手指放到扳机上…', 15, MUTED, 600);
      return;
    }
    if (committed) {
      this.centerText(centerX, centerY + 132, '你的选择已封存，等待其他人…', 15, GOLD, 700);
      return;
    }
    const fixedTarget = roulette.fixedTargets[me!.id];
    const needsTarget = !fixedTarget;
    let statusY = centerY + 122;
    let triggerY = centerY + 150;
    if (needsTarget) {
      const targets = Object.values(state.players).filter((player) => player.alive && player.id !== me!.id);
      const targetWidth = Math.min(98, (width - 40 - Math.max(0, targets.length - 1) * 8) / Math.max(1, targets.length));
      const totalWidth = targets.length * targetWidth + Math.max(0, targets.length - 1) * 8;
      targets.forEach((target, index) => {
        this.button(
          centerX - totalWidth / 2 + index * (targetWidth + 8),
          centerY + 105,
          targetWidth,
          32,
          target.name,
          () => { this.selectedTarget = target.id; },
          false,
          this.selectedTarget === target.id ? 'gold' : 'quiet',
        );
      });
      statusY = centerY + 151;
      triggerY = centerY + 176;
    }
    this.centerText(
      centerX,
      statusY,
      needsTarget ? (this.selectedTarget ? `目标：${this.nameOf(this.selectedTarget)}` : '先点击一名对手') : `枪口指向：${this.nameOf(fixedTarget)}`,
      14,
      needsTarget && !this.selectedTarget ? MUTED : INK,
      600,
    );
    this.button(
      centerX - 82,
      triggerY,
      164,
      48,
      '扣动扳机',
      () => void parti.action('pullTrigger', this.selectedTarget ? { targetId: this.selectedTarget } : undefined),
      needsTarget && !this.selectedTarget,
      'danger',
    );
  }

  private drawResolution(width: number, height: number) {
    const state = this.state!;
    this.scrim(width, height, 0.65);
    const shots = state.resolution?.shots ?? [];
    const lethal = shots.filter((shot) => shot.lethal);
    this.drawRevealedCards(width / 2, Math.max(116, height * 0.43 - 142));
    this.centerText(width / 2, height * 0.43, lethal.length ? '枪声响起' : '咔哒——空膛', 38, lethal.length ? BLOOD_BRIGHT : INK, 900);
    this.centerText(
      width / 2,
      height * 0.43 + 54,
      lethal.length
        ? lethal.map((shot) => `${this.nameOf(shot.targetId)} 倒下`).join(' · ')
        : '今晚还有人得继续说谎',
      15,
      MUTED,
      600,
    );
  }

  private drawFinished(width: number, height: number) {
    const state = this.state!;
    this.scrim(width, height, 0.78);
    this.centerText(width / 2, height * 0.4, state.draw ? '午夜无人归还' : `${this.nameOf(state.winnerId)} 活到最后`, 34, state.draw ? BLOOD_BRIGHT : GOLD, 900);
    const me = this.me();
    if (me) this.centerText(width / 2, height * 0.4 + 52, `累计胜场 ${me.wins}`, 14, MUTED, 600);
    if (parti.playerId === state.hostId) {
      this.button(width / 2 - 82, height * 0.4 + 84, 164, 46, '返回大厅', () => void parti.action('abortMatch'), false, 'gold');
    } else {
      this.centerText(width / 2, height * 0.4 + 96, '等待房主重新开桌', 14, MUTED, 600);
    }
  }

  private drawCard(x: number, y: number, card: Card, width: number, height: number, selected: boolean) {
    const special = card.kind === 'master' || card.kind === 'chaos';
    this.panel(x, y, width, height, special ? '#2a1725' : '#e8ded0', selected ? GOLD : special ? '#7b415f' : '#9e8d7c');
    const red = card.kind === 'A' || card.kind === 'Q' || card.kind === 'chaos';
    const color = special ? '#f2d9e9' : red ? '#8d1f2d' : '#161112';
    const label = card.kind === 'joker' ? '鬼' : card.kind === 'master' ? '主' : card.kind === 'chaos' ? '乱' : card.kind;
    this.text(x + 8, y + 7, label, Math.max(18, width * 0.34), color, 900);
    this.centerText(x + width / 2, y + height * 0.55, label, Math.max(24, width * 0.48), color, 900);
    if (card.devilMarked && this.state?.ruleset === 'devil') {
      this.centerText(x + width / 2, y + height - 16, '◆ 恶魔印', 10, '#a20f26', 800);
    }
  }

  private drawCardBack(x: number, y: number, width: number, height: number) {
    this.panel(x, y, width, height, '#281318', '#8a343d');
    mainContext.save();
    mainContext.strokeStyle = '#a96a5d';
    mainContext.globalAlpha = 0.45;
    for (let offset = 8; offset < width - 6; offset += 9) {
      mainContext.beginPath();
      mainContext.moveTo(x + offset, y + 7);
      mainContext.lineTo(x + width - 7, y + offset + 18);
      mainContext.stroke();
    }
    mainContext.restore();
    this.centerText(x + width / 2, y + height / 2, 'M', 24, '#d2a56a', 900);
  }

  private drawRevealedCards(centerX: number, y: number) {
    if(wagerPresentationMask(this.activeAnimation,this.animations.presentationAnimations()).hiddenReveal)return;
    const cards = this.state?.reveal?.cards ?? [];
    if (!cards.length) return;
    const width = 42;
    const height = 58;
    const gap = 7;
    const total = cards.length * width + Math.max(0, cards.length - 1) * gap;
    cards.forEach((card, index) => {
      this.drawCard(centerX - total / 2 + index * (width + gap), y, card, width, height, false);
    });
  }

  private drawRevolver(x: number, y: number, radius: number) {
    const context = mainContext;
    context.save();
    context.fillStyle = '#171719';
    context.strokeStyle = '#897d73';
    context.lineWidth = 5;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    for (let index = 0; index < 6; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 6;
      const chamberX = x + Math.cos(angle) * radius * 0.58;
      const chamberY = y + Math.sin(angle) * radius * 0.58;
      context.fillStyle = '#050505';
      context.beginPath();
      context.arc(chamberX, chamberY, radius * 0.17, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.fillStyle = '#22171a';
    context.beginPath();
    context.moveTo(x + radius * 0.5, y + radius * 0.7);
    context.lineTo(x + radius * 1.15, y + radius * 1.55);
    context.lineTo(x + radius * 0.62, y + radius * 1.78);
    context.lineTo(x + radius * 0.05, y + radius * 0.88);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private toggleCard(cardId: string) {
    if (this.selectedCards.has(cardId)) {
      this.selectedCards.delete(cardId);
      return;
    }
    const limit = this.state?.ruleset === 'chaos' ? 1 : 3;
    if (this.selectedCards.size >= limit) {
      this.showFlash(this.state?.ruleset === 'chaos' ? '混沌局每次只能出一张' : '一次最多暗出三张');
      return;
    }
    this.selectedCards.add(cardId);
    this.playSound(this.cardSound, 0.42);
  }

  private rouletteTitle() {
    const reveal = this.state?.reveal;
    if (reveal?.reason === 'chaos') return '所有人，同时选择';
    if (reveal?.reason === 'master') return '主宰指定一条命';
    if (reveal?.reason === 'devil' || reveal?.reason === 'devils-deal') return '恶魔正在收债';
    return '真相已经上膛';
  }

  private canTarget(playerId: string) {
    const state = this.state;
    const me = this.me();
    if (!state || !me || state.phase !== 'roulette' || !state.roulette) return false;
    if (!state.roulette.shooterIds.includes(me.id) || state.roulette.committed.includes(me.id)) return false;
    if (state.roulette.fixedTargets[me.id]) return false;
    return playerId !== me.id && Boolean(state.players[playerId]?.alive);
  }

  private me() {
    return this.state && parti.playerId ? this.state.players?.[parti.playerId] ?? null : null;
  }

  private nameOf(playerId: string | null) {
    if (!playerId) return '无人';
    if (playerId === parti.playerId) return '你';
    return this.state?.players[playerId]?.name ?? '未知赌客';
  }

  private playSound(sound: Sound, volume: number) {
    if (!this.soundEnabled) return;
    try {
      sound.play(undefined, volume);
    } catch {
      // Browsers may defer audio until the first direct interaction.
    }
  }

  private showFlash(message: string) {
    this.flash = message;
    this.flashUntil = performance.now() + 1800;
  }

  private drawFlash(width: number, height: number) {
    if (!this.flash) return;
    const boxWidth = Math.min(420, width - 32);
    this.panel(width / 2 - boxWidth / 2, Math.min(height * 0.2, 126), boxWidth, 44, '#130e10', '#8f3a40', 0.96);
    this.centerText(width / 2, Math.min(height * 0.2, 126) + 22, this.flash, 14, INK, 700);
  }

  private drawAnimation(width: number, height: number) {
    const fx = this.activeAnimation;
    if (!fx) return;
    const context = mainContext, progress = fx.progress, eased = easeInOutCubic(progress), table = { x: width / 2, y: height * .48 };
    const actor = fx.actorId ? this.state?.players[fx.actorId] : null;
    const angle = actor ? actor.seat / Math.max(2, this.state?.seats.filter(Boolean).length ?? 2) * Math.PI * 2 + Math.PI / 2 : Math.PI / 2;
    const origin = { x: width / 2 + Math.cos(angle) * width * .38, y: height * .5 + Math.sin(angle) * height * .32 };
    context.save();
    if (fx.kind === 'cardsCommitted') {
      for (let index = 0; index < Math.max(1, fx.count ?? 1); index += 1) {
        const stagger = Math.max(0, Math.min(1, progress * 1.4 - index * .12));
        const x = origin.x + (table.x + index * 8 - origin.x) * easeInOutCubic(stagger), y = origin.y + (table.y + index * 5 - origin.y) * easeInOutCubic(stagger) - Math.sin(Math.PI * stagger) * 45;
        context.save(); context.translate(x, y); context.rotate((1-stagger) * .35 + index * .04); this.panel(-25,-35,50,70,'#281417',GOLD,.98); this.centerText(0,0,'?',24,GOLD,800); context.restore();
      }
    } else if (fx.kind === 'reveal' || fx.kind === 'specialResolved') {
      context.fillStyle = fx.label?.includes('谎言') || fx.label?.includes('恶魔') ? `rgba(126,18,29,${.18 * Math.sin(Math.PI*progress)})` : `rgba(199,154,84,${.1 * Math.sin(Math.PI*progress)})`;
      context.fillRect(0,0,width,height);
      (fx.cards ?? []).forEach((card, index) => {
        const spread = (index - ((fx.cards?.length ?? 1)-1)/2) * 62, flip = Math.abs(Math.cos(Math.PI * Math.min(1, Math.max(0, progress * 1.5 - index * .08))));
        context.save(); context.translate(table.x + spread, table.y - 58 - Math.sin(Math.PI*progress)*25); context.scale(Math.max(.05,flip),1); this.drawCard(-25,-36,card,50,72,false); context.restore();
      });
      if (fx.label) { context.globalAlpha = Math.sin(Math.PI*progress); context.shadowBlur=26; context.shadowColor=BLOOD_BRIGHT; this.centerText(width/2,height*.25,fx.label,32,fx.label.includes('失败')||fx.label.includes('谎言')?BLOOD_BRIGHT:GOLD,800); }
    } else if (fx.kind === 'shots') {
      const lethal = fx.shots?.some((shot)=>shot.lethal), spin = eased * Math.PI * 8;
      context.translate(width/2,height*.37); context.rotate(spin); context.strokeStyle=lethal?BLOOD_BRIGHT:GOLD; context.lineWidth=5; context.beginPath(); context.arc(0,0,42,0,Math.PI*2); context.stroke();
      for(let i=0;i<6;i++){context.beginPath();context.arc(Math.cos(i*Math.PI/3)*23,Math.sin(i*Math.PI/3)*23,7,0,Math.PI*2);context.stroke()}
      context.rotate(-spin); context.globalAlpha=Math.sin(Math.PI*progress); this.centerText(0,72,lethal?'枪 响':'咔 哒',30,lethal?BLOOD_BRIGHT:GOLD,800);
    } else if (fx.kind === 'roundSettled') {
      context.globalAlpha=Math.sin(Math.PI*Math.min(1,progress)); const glow=context.createRadialGradient(width/2,height*.4,20,width/2,height*.4,height*.55); glow.addColorStop(0,'rgba(199,154,84,.3)'); glow.addColorStop(1,'transparent'); context.fillStyle=glow; context.fillRect(0,0,width,height); this.centerText(width/2,height*.32,fx.label??'赌局结束',36,GOLD,800);
    }
    context.restore();
  }

  private drawImpactFlash(width: number, height: number) {
    const remaining = this.impactUntil - performance.now();
    if (remaining <= 0) return;
    mainContext.save();
    mainContext.globalAlpha = Math.min(0.48, (remaining / 360) * 0.48);
    const flare = mainContext.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, width * 0.7);
    flare.addColorStop(0, '#ff5961');
    flare.addColorStop(0.35, '#9f1622');
    flare.addColorStop(1, '#300008');
    mainContext.fillStyle = flare;
    mainContext.fillRect(0, 0, width, height);
    mainContext.restore();
  }

  private drawRulesOverlay(width: number, height: number) {
    this.hitRegions.push({ x: 0, y: 0, width, height, onClick: () => {} });
    this.scrim(width, height, 0.88);
    const panelWidth = Math.min(600, width - 28);
    const panelHeight = Math.min(430, height - 120);
    const x = (width - panelWidth) / 2;
    const y = Math.max(104, (height - panelHeight) / 2);
    this.panel(x, y, panelWidth, panelHeight, '#171013', '#8b5e49', 0.98);
    this.centerText(width / 2, y + 34, `${RULE_NAMES[this.state!.ruleset]}规则`, 24, '#f0c47f', 900);
    const details = RULE_DETAILS[this.state!.ruleset];
    const lineStep = Math.max(38, (panelHeight - 148) / details.length);
    const compact = panelWidth < 430 || panelHeight < 390;
    let lineY = y + 74;
    details.forEach((rule, index) => {
      this.text(x + 24, lineY, `${index + 1}.`, compact ? 12 : 13, GOLD, 800);
      this.wrappedText(x + 48, lineY, rule, panelWidth - 72, compact ? 12 : 13, INK, 3);
      lineY += lineStep;
    });
    this.centerText(width / 2, y + panelHeight - 66, '无倒计时 · 轮盘必须由相关玩家手动扣动', 12, MUTED, 600);
    this.button(width / 2 - 64, y + panelHeight - 46, 128, 34, '收起规则', () => {
      this.rulesOpen = false;
    }, false, 'gold');
  }

  private scrim(width: number, height: number, alpha: number) {
    mainContext.save();
    mainContext.globalAlpha = alpha;
    mainContext.fillStyle = BLACK;
    mainContext.fillRect(0, 0, width, height);
    mainContext.restore();
  }

  private button(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
    disabled = false,
    style: 'gold' | 'danger' | 'quiet' = 'gold',
  ) {
    const fill = disabled ? '#2d2727' : style === 'danger' ? '#7f1d27' : style === 'quiet' ? '#241a1c' : '#b98948';
    const stroke = disabled ? '#4b4140' : style === 'danger' ? '#e35a62' : style === 'quiet' ? '#74605a' : '#f0c47f';
    this.panel(x, y, width, height, fill, stroke);
    this.centerText(x + width / 2, y + height / 2, label, height <= 30 ? 11 : 14, disabled ? '#766d69' : INK, 800);
    if (!disabled) this.hitRegions.push({ x, y, width, height, onClick });
  }

  private panel(x: number, y: number, width: number, height: number, fill: string, stroke: string, alpha = 1) {
    const context = mainContext;
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = fill;
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    this.roundedRectPath(x, y, width, height, Math.min(10, height * 0.18));
    context.fill();
    context.stroke();
    context.restore();
  }

  private roundedRectPath(x: number, y: number, width: number, height: number, radius: number) {
    const context = mainContext;
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  private text(x: number, y: number, value: string, size: number, color: string, weight: number | string) {
    const context = mainContext;
    context.font = `${weight} ${size}px ${FONT}`;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(value, x, y);
  }

  private centerText(x: number, y: number, value: string, size: number, color: string, weight: number | string) {
    const context = mainContext;
    context.font = `${weight} ${size}px ${FONT}`;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(value, x, y);
  }

  private wrappedText(x: number, y: number, value: string, maxWidth: number, size: number, color: string, maxLines: number) {
    const context = mainContext;
    context.font = `500 ${size}px ${FONT}`;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    let line = '';
    let lineIndex = 0;
    for (const character of value) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        context.fillText(line, x, y + lineIndex * size * 1.35);
        line = character;
        lineIndex += 1;
        if (lineIndex >= maxLines) return;
      } else line = candidate;
    }
    if (lineIndex < maxLines) context.fillText(line, x, y + lineIndex * size * 1.35);
  }

  private contains(hit: HitRegion, x: number, y: number) {
    return x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height;
  }
}

// ===== AI agent 转述（迁移自旧 worker 侧 describe()/wagerObserve()，改为客户端本玩家视角）=====
function buildWagerGuide(state: GameState | null, hand: Card[], playerId: string | null) {
  if (!state || !playerId) return { summary: '午夜赌局。', phase: 'connecting', narrative: '正在连接房间…', isYourTurn: false, availableActions: [] };
  const guide = {
    summary: '午夜赌局：吹牛（暗出牌+质疑）+ 俄罗斯轮盘。玩家暗扣声称符合桌面点数的牌，被质疑或触发特殊牌时开枪，活到最后者胜。',
    objective: `每轮暗出声称是「${state.tableRank ?? '桌面点数'}」的牌；被质疑时若说谎则说谎者开枪，否则质疑者开枪。开枪可能是空枪或致命。活到最后的玩家获胜。当前规则：${state.ruleset}。`,
    actions: [
      { name: 'setReady', description: '大厅内准备/取消准备。', payloadSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'] }, examples: [{ ready: true }] },
      { name: 'setRuleset', description: '房主在大厅切换规则。', payloadSchema: { type: 'object', properties: { ruleset: { enum: ['classic', 'devil', 'chaos'] } }, required: ['ruleset'] } },
      { name: 'playCards', description: '轮到你时暗扣 1-3 张牌（chaos 规则每次 1 张），声称它们符合桌面点数。恶魔牌必须单独打出。', payloadSchema: { type: 'object', properties: { cardIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } }, required: ['cardIds'] } },
      { name: 'callLiar', description: '轮到你时质疑上家暗出的牌；翻开后由说谎方或误判方开枪。', payloadSchema: { type: 'null' } },
      { name: 'callDevilsDeal', description: '仅恶魔局：轮到你且牌堆≥4张时发动恶魔交易，翻开最后四张。', payloadSchema: { type: 'null' } },
      { name: 'pullTrigger', description: '轮盘阶段扣动扳机。自射时无需 targetId；对射时 targetId 指定活着的对手。', payloadSchema: { type: 'object', properties: { targetId: { type: 'string' } } } },
      { name: 'syncPrivate', description: '请求重发自己的手牌。', payloadSchema: { type: 'null' } },
      { name: 'abortMatch', description: '房主中止牌局并返回大厅。', payloadSchema: { type: 'null' } },
    ],
    glossary: {
      phase: 'lobby=大厅, playing=暗出/质疑, roulette=开枪, resolution=结算过场, finished=结束',
      ruleset: 'classic=经典, devil=恶魔局, chaos=混沌局。',
      tableRank: '本轮桌面点数（A/K/Q）；你声称暗出的牌都是它。',
      currentPlayerId: '当前该行动的玩家 id。',
      lastPlay: '上一手 {playerId, count}，只公开张数不公开牌面。',
      pileCount: '牌堆当前累计张数。',
      reveal: '翻牌信息（质疑/恶魔/主宰等触发时）。',
      roulette: '开枪状态：shooterIds 需开枪者，fixedTargets 固定目标，committed 已开枪者。',
      safePulls: '各玩家已扣下的空枪数（离致命更近）。',
      handCount: '各玩家剩余手牌数。',
    },
  };

  const me = state.players[playerId];
  if (!me) {
    return { ...guide, phase: state.phase, narrative: '你当前不在牌桌上，正在旁观。', isYourTurn: false, availableActions: [], waitingFor: '等待入座' };
  }
  const handStr = hand.length ? hand.map((card) => `${card.kind}#${card.id}${card.devilMarked ? '(恶魔纹)' : ''}`).join(' ') : '（无）';
  const livingIds = state.seats.filter((id): id is string => Boolean(id && state.players[id]?.alive));
  const roster = livingIds.map((id) => `${state.players[id]!.name}:${state.players[id]!.handCount}张/空枪${state.players[id]!.safePulls}`).join('，');
  const base = `规则 ${state.ruleset}，桌面点数 ${state.tableRank ?? '?'}。你（${me.name}）手牌：${handStr}。牌堆 ${state.pileCount} 张。存活：${roster}。`;

  if (state.phase === 'lobby') {
    const isHost = state.hostId === playerId;
    const actions: Array<Record<string, unknown>> = [{ name: 'setReady', hint: me.ready ? '已准备，可取消' : '准备开始', payloadSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'] } }];
    if (isHost) actions.push({ name: 'setRuleset', hint: '切换规则', payloadSchema: { type: 'object', properties: { ruleset: { enum: ['classic', 'devil', 'chaos'] } }, required: ['ruleset'] } });
    return { ...guide, phase: 'lobby', narrative: `${base} ${state.message}`, isYourTurn: !me.ready, availableActions: actions, waitingFor: me.ready ? '等待其他玩家准备' : undefined };
  }

  if (state.phase === 'playing') {
    if (state.currentPlayerId !== playerId) {
      const cur = state.currentPlayerId ? state.players[state.currentPlayerId]?.name ?? '其他玩家' : '其他玩家';
      return { ...guide, phase: 'playing', narrative: `${base} 轮到 ${cur} 行动。`, isYourTurn: false, availableActions: [], waitingFor: `等待 ${cur} 出牌或质疑` };
    }
    const limit = state.ruleset === 'chaos' ? 1 : 3;
    const actions: Array<Record<string, unknown>> = [{ name: 'playCards', hint: `暗扣 1-${limit} 张，声称都是 ${state.tableRank}`, payloadSchema: { type: 'object', properties: { cardIds: { type: 'array', items: { enum: hand.map((card) => card.id) }, minItems: 1, maxItems: limit } }, required: ['cardIds'] } }];
    if (state.pileCount > 0 && state.lastPlay && state.lastPlay.playerId !== playerId) actions.push({ name: 'callLiar', hint: `质疑上家暗出的 ${state.lastPlay.count} 张牌` });
    if (state.ruleset === 'devil' && state.pileCount >= 4) actions.push({ name: 'callDevilsDeal', hint: '发动恶魔交易，翻开最后四张' });
    return { ...guide, phase: 'playing', narrative: `${base} 轮到你行动。`, isYourTurn: true, availableActions: actions };
  }

  if (state.phase === 'roulette' && state.roulette) {
    const roulette = state.roulette;
    const isShooter = roulette.shooterIds.includes(playerId) && !roulette.committed.includes(playerId);
    if (!isShooter) {
      return { ...guide, phase: 'roulette', narrative: `${base} 轮盘阶段，等待开枪。`, isYourTurn: false, availableActions: [], waitingFor: '等待开枪结算' };
    }
    const fixed = roulette.fixedTargets[playerId];
    if (fixed) {
      return { ...guide, phase: 'roulette', narrative: `${base} 你必须朝 ${state.players[fixed]?.name ?? '自己'} 开枪。`, isYourTurn: true, availableActions: [{ name: 'pullTrigger', hint: '扣动扳机（目标已固定，无需 targetId）', payloadSchema: { type: 'null' } }] };
    }
    const targets = livingIds.filter((id) => id !== playerId);
    return { ...guide, phase: 'roulette', narrative: `${base} 轮到你开枪，选择一名活着的对手。`, isYourTurn: true, availableActions: [{ name: 'pullTrigger', hint: '选择目标开枪', payloadSchema: { type: 'object', properties: { targetId: { enum: targets } }, required: ['targetId'] } }] };
  }

  if (state.phase === 'resolution') {
    return { ...guide, phase: 'resolution', narrative: `${base} ${state.message}`, isYourTurn: false, availableActions: [], waitingFor: '等待本轮结算' };
  }

  if (state.phase === 'finished') {
    const winner = state.winnerId ? state.players[state.winnerId]?.name : null;
    const isHost = state.hostId === playerId;
    return { ...guide, phase: 'finished', narrative: `${base} ${state.draw ? '无人幸存。' : winner ? `${winner} 活到了最后。` : ''}`, isYourTurn: false, availableActions: isHost ? [{ name: 'abortMatch', hint: '返回大厅' }] : [], waitingFor: isHost ? undefined : '等待房主开始新局' };
  }

  return { ...guide, phase: state.phase, narrative: `${base} ${state.message}`, isYourTurn: false, availableActions: [], waitingFor: '请稍候' };
}
