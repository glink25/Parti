/**
 * Canvas 场景绘制：标靶/镖/座位/飞行/弹分（纯绘制，输入为视图模型）。
 * 角度约定与逻辑层一致：0 在 12 点，顺时针为正。
 * viewOffset 为纯视觉偏移（让每个玩家从自己座位正下方的视角观看），不影响判定。
 */

import { ZONE_ARC } from '../../shared/constants';
import type { ActiveEvent, BoardDart, GamePlayer } from '../../shared/protocol';

export interface FlightView {
  /** 出手世界方向（座位方向） */
  fromAngle: number;
  /** 命中点世界方向（命中时刻的板面角 + 转角，预先算好） */
  toAngle: number;
  /** 0..1 飞行进度 */
  t: number;
  color: string;
}

export interface SceneView {
  now: number;
  visualAngle: number;
  /** 视角旋转偏移：让本玩家座位渲染在屏幕正下方（纯视觉，不影响判定） */
  viewOffset: number;
  /** 瞄准预览：我的回合可发射时，在座位处展示预览镖与引导线 */
  aimPreview: { angle: number; color: string } | null;
  darts: BoardDart[];
  seatedPlayers: GamePlayer[];
  currentPlayerId: string | null;
  event: ActiveEvent | null;
  myId: string;
  flights: FlightView[];
}

interface Popup {
  worldAngle: number;
  text: string;
  tone: 'score' | 'bad' | 'good';
  startWall: number;
}

const SEAT_COLORS = [
  '#f2c14e', '#e0644f', '#5fb85f', '#5f9de0',
  '#b07fd8', '#e08bb0', '#4fc4b5', '#d8a05f',
];

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

const POPUP_TTL = 900;

export class Scene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private readonly popups: Popup[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  addPopup(worldAngle: number, text: string, tone: Popup['tone']): void {
    this.popups.push({ worldAngle, text, tone, startWall: performance.now() });
  }

  /**
   * 布局量（供 HUD 对齐用）。
   * 「标靶 + 飞镖准备区走廊」为内部游戏区，座位头像与标签在其之外；
   * 整体在 HUD 安全区内缩放：顶部避开 top-bar，底部避开发射按钮区。
   */
  layout(): { cx: number; cy: number; boardR: number; seatR: number } {
    const topPad = 64;
    const bottomPad = Math.min(230, Math.max(180, this.height * 0.28));
    const sidePad = 20;
    const availW = Math.max(120, this.width - sidePad * 2);
    const availH = Math.max(120, this.height - topPad - bottomPad);
    // 座位圈 = 1.85×boardR；头像+标签外缘余量 ≈ 56px
    const boardR = Math.max(56, (Math.min(availW, availH) / 2 - 56) / 1.85);
    return {
      cx: this.width / 2,
      cy: topPad + availH / 2,
      boardR,
      seatR: boardR * 1.85,
    };
  }

  render(view: SceneView): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground();
    const { cx, cy, boardR, seatR } = this.layout();

    this.drawBoard(cx, cy, boardR, view);
    if (view.aimPreview) this.drawAimPreview(cx, cy, boardR, view);
    this.drawDarts(cx, cy, boardR, view);
    this.drawFlights(cx, cy, boardR, view);
    this.drawSeats(cx, cy, seatR, view);
    this.drawPopups(cx, cy, boardR, view);
  }

  // -------------------------------------------------------------------------

  private drawBackground(): void {
    const { ctx, width, height } = this;
    const g = ctx.createRadialGradient(
      width / 2, height * 0.42, 10,
      width / 2, height * 0.5, Math.max(width, height) * 0.75,
    );
    g.addColorStop(0, '#3a2c20');
    g.addColorStop(0.55, '#241a12');
    g.addColorStop(1, '#120c08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  private drawBoard(cx: number, cy: number, r: number, view: SceneView): void {
    const { ctx } = this;

    // 木底
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.fillStyle = '#4a3320';
    ctx.fill();
    const wood = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    wood.addColorStop(0, '#c89a62');
    wood.addColorStop(0.7, '#b0824c');
    wood.addColorStop(1, '#8a6136');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = wood;
    ctx.fill();

    // 旋转部分：环带 + 刻度 + 区域（含视角偏移）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(view.visualAngle + view.viewOffset);

    // 同心环
    ctx.lineWidth = 2;
    for (const [rr, color] of [
      [0.32, 'rgba(90,58,30,0.55)'],
      [0.62, 'rgba(90,58,30,0.45)'],
      [0.88, 'rgba(90,58,30,0.6)'],
    ] as const) {
      ctx.beginPath();
      ctx.arc(0, 0, r * rr, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    // 交替扇区（让旋转肉眼可见）
    for (let i = 0; i < 12; i += 1) {
      if (i % 2 !== 0) continue;
      const a0 = (i * Math.PI) / 6;
      const a1 = ((i + 1) * Math.PI) / 6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 0.98, a0 - Math.PI / 2, a1 - Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,82,44,0.16)';
      ctx.fill();
    }

    // 刻度
    ctx.strokeStyle = 'rgba(70,44,22,0.7)';
    for (let i = 0; i < 24; i += 1) {
      const a = (i * Math.PI) / 12;
      const len = i % 2 === 0 ? r * 0.09 : r * 0.05;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * (r - len), -Math.cos(a) * (r - len));
      ctx.lineTo(Math.sin(a) * (r - 2), -Math.cos(a) * (r - 2));
      ctx.lineWidth = i % 2 === 0 ? 2.5 : 1.5;
      ctx.stroke();
    }

    // 事件区域
    if (view.event && view.event.zoneAngle !== null) {
      const z = view.event.zoneAngle - Math.PI / 2;
      const half = ZONE_ARC / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 0.97, z - half, z + half);
      ctx.closePath();
      ctx.fillStyle = this.zoneFill(view.event.kind);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.97, z - half, z + half);
      ctx.strokeStyle = this.zoneStroke(view.event.kind);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 中心钉
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#5a3a1e';
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  private zoneFill(kind: string): string {
    switch (kind) {
      case 'heal_zone': return 'rgba(80,200,120,0.30)';
      case 'slow_zone': return 'rgba(90,160,230,0.30)';
      case 'wide_zone': return 'rgba(230,160,60,0.32)';
      case 'multishot_zone': return 'rgba(180,120,230,0.30)';
      default: return 'rgba(255,255,255,0.18)';
    }
  }

  private zoneStroke(kind: string): string {
    switch (kind) {
      case 'heal_zone': return 'rgba(120,230,160,0.8)';
      case 'slow_zone': return 'rgba(130,190,255,0.8)';
      case 'wide_zone': return 'rgba(255,190,90,0.85)';
      case 'multishot_zone': return 'rgba(210,160,255,0.8)';
      default: return 'rgba(255,255,255,0.5)';
    }
  }

  /**
   * 瞄准预览（纯 2D，无透视）：准备中的飞镖与标靶同属中心构图——
   * 放在标靶外缘的中圈走廊上，尺寸与板上镖完全一致（同一 base），
   * 仅用轻微浮动动画提示待发状态。头像等信息在外围，不遮挡。
   */
  private drawAimPreview(
    cx: number,
    cy: number,
    boardR: number,
    view: SceneView,
  ): void {
    const aim = view.aimPreview!;
    const angle = aim.angle + view.viewOffset;
    const base = boardR / 85; // 全场景镖的统一缩放基准：与标靶视为整体
    // 轻微浮动（呼吸感），位置即飞行起点，玩家据此预判轨迹
    const bob = 4 * Math.sin(view.now / 320);
    this.drawDart(cx, cy, this.readyRadius(boardR) + bob, angle, aim.color, 1, base);
  }

  /** 投掷准备位：标靶外圈走廊中部，属于中心构图（与座位头像无关） */
  private readyRadius(boardR: number): number {
    return boardR * 1.35;
  }

  /**
   * 扎镖位置：镖尾参考点半径。镖尖仅没入标靶边缘薄薄一层（6×base），
   * 镖身大部分露在板外——「扎在边缘」而非「射进标靶内部」。
   */
  private stickRadius(boardR: number, base: number): number {
    return boardR - 6 * base + 13 * base;
  }

  private drawDarts(cx: number, cy: number, r: number, view: SceneView): void {
    const base = r / 85; // 与预览镖/飞行镖同一缩放基准
    const stickR = this.stickRadius(r, base);
    for (const dart of view.darts) {
      const world = dart.boardAngle + view.visualAngle + view.viewOffset;
      const owner = view.seatedPlayers.find((p) => p.id === dart.ownerId);
      const color = seatColor(owner?.seat ?? 0);
      this.drawDart(cx, cy, stickR, world, color, dart.widthFactor, base);
    }
  }

  /** 画一支钉在半径 radius 处、指向圆心的镖 */
  private drawDart(
    cx: number,
    cy: number,
    radius: number,
    angle: number,
    color: string,
    widthFactor: number,
    scale: number,
  ): void {
    const { ctx } = this;
    const tipX = cx + Math.sin(angle) * (radius - 13 * scale);
    const tipY = cy - Math.cos(angle) * (radius - 13 * scale);
    const tailX = cx + Math.sin(angle) * (radius + 11 * scale);
    const tailY = cy - Math.cos(angle) * (radius + 11 * scale);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2c2018';
    ctx.lineWidth = 3.4 * scale * widthFactor;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * scale * widthFactor;
    ctx.beginPath();
    ctx.moveTo(tipX + (tailX - tipX) * 0.3, tipY + (tailY - tipY) * 0.3);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
    // 尾翼
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(tailX, tailY, 3 * scale * widthFactor, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawFlights(cx: number, cy: number, boardR: number, view: SceneView): void {
    const base = boardR / 85;
    const startR = this.readyRadius(boardR); // 与预览镖同一起点
    const endR = this.stickRadius(boardR, base); // 碰到标靶边缘即停
    for (const f of view.flights) {
      const t = f.t;
      // 纯 2D 平视：镖从准备位沿视线匀速飞向标靶，尺寸全程不变（无 Z 轴）
      const ease = t * t;
      const radius = startR + (endR - startR) * ease;
      let delta = f.toAngle - f.fromAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const angle = f.fromAngle + delta * ease + view.viewOffset;
      this.drawDart(cx, cy, radius, angle, f.color, 1, base);
    }
  }

  private drawSeats(cx: number, cy: number, seatR: number, view: SceneView): void {
    const { ctx } = this;
    // 头像随场景整体缩放（小屏不挤压飞镖准备区走廊）
    const avatarR = Math.min(30, Math.max(18, seatR * 0.16));
    for (const p of view.seatedPlayers) {
      if (p.seat < 0) continue;
      const angle =
        (p.seat * Math.PI * 2) / Math.max(1, view.seatedPlayers.length) + view.viewOffset;
      const x = cx + Math.sin(angle) * seatR;
      const y = cy - Math.cos(angle) * seatR;
      const color = seatColor(p.seat);
      const isCurrent = p.id === view.currentPlayerId;
      const isMe = p.id === view.myId;
      const out = p.status === 'eliminated';
      const radius = avatarR;

      ctx.save();
      if (out || !p.connected) ctx.globalAlpha = out ? 0.45 : 0.65;

      // 当前出手者光环
      if (isCurrent && !out) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,220,130,0.9)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = out ? '#4a4038' : color;
      ctx.fill();
      if (isMe) {
        ctx.strokeStyle = '#fff2d8';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // 名字首字
      ctx.fillStyle = out ? '#9a8f80' : '#241a10';
      ctx.font = `bold ${radius * 0.85}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((p.name || '?').slice(0, 1).toUpperCase(), x, y + 1);

      // 血量
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = out ? '#7a7064' : '#ff6b6b';
      const hearts = out ? '✕' : '♥'.repeat(Math.max(0, p.health)) || '✕';
      ctx.fillText(hearts, x, y + radius + 14);

      // 分数
      ctx.fillStyle = '#e8d8b8';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(`${p.score}`, x, y - radius - 10);

      // 离线标记
      if (!p.connected && !out) {
        ctx.fillStyle = '#cfc4b2';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText('离线', x, y + radius + 28);
      }
      ctx.restore();
    }
  }

  private drawPopups(cx: number, cy: number, boardR: number, view: SceneView): void {
    const { ctx } = this;
    const { now } = view;
    for (let i = this.popups.length - 1; i >= 0; i -= 1) {
      const p = this.popups[i];
      const t = (now - p.startWall) / POPUP_TTL;
      if (t >= 1) {
        this.popups.splice(i, 1);
        continue;
      }
      const angle = p.worldAngle + view.viewOffset;
      const radius = boardR + t * 34;
      const x = cx + Math.sin(angle) * radius;
      const y = cy - Math.cos(angle) * radius - t * 18;
      ctx.save();
      ctx.globalAlpha = 1 - t * t;
      ctx.font = `bold ${p.tone === 'score' ? 22 : 18}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.tone === 'score' ? '#ffe9a8' : p.tone === 'good' ? '#9fe8b4' : '#ff9a8a';
      ctx.strokeStyle = 'rgba(20,12,6,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, x, y);
      ctx.fillText(p.text, x, y);
      ctx.restore();
    }
  }
}
