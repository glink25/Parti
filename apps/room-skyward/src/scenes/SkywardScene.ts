import { mainCanvas, mainContext } from 'littlejsengine';
import { CHUNK_HEIGHT, PLAYER_RADIUS, VIEW_HEIGHT, WORLD_WIDTH, type EnemySpawn, type GameState, type PickupSpawn, type Platform, type PublicPlayer, type TerrainChunk } from '../game/types';
import { biomeFor, gateY, generateChunk } from '../game/world';

type Bullet = { shotId: string; projectileIndex: number; x: number; y: number; vy: number; life: number; cosmetic: boolean; color: string };
type UiHit = { x: number; y: number; w: number; h: number; action: () => void };
type Viewport = { x: number; y: number; w: number; h: number; scale: number };

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const GRAVITY = -1750;
const JUMP_SPEED = 930;
const MOVE_SPEED = 390;

export class SkywardScene {
  private state: GameState | null = null;
  private local = { x: WORLD_WIDTH / 2, y: 150, vy: 0, cameraBottom: 0, viewBottom: 0, alive: true };
  private direction: -1 | 0 | 1 = 0;
  private keyDirection: -1 | 0 | 1 = 0;
  private touchDirections = new Map<number, -1 | 1>();
  private bullets: Bullet[] = [];
  private chunks = new Map<number, TerrainChunk>();
  private disposers: Array<() => void> = [];
  private uiHits: UiHit[] = [];
  private viewport: Viewport = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  private pixelRatio = 1;
  private previousTime = performance.now();
  private telemetryAt = 0;
  private shotAt = 0;
  private hitAt = 0;
  private flash = '';
  private flashUntil = 0;
  private tiltEnabled = false;
  private tiltDirection: -1 | 0 | 1 = 0;
  private remoteVisuals: Record<string, { x: number; y: number }> = {};
  private pendingDeath = false;
  private appliedPositionEpoch = -1;
  private shotSequence = 0;
  private pendingDefeatedEnemies = new Set<string>();

  init() {
    this.disposers.push(
      parti.onState((value) => this.receiveState(value as GameState)),
      parti.onEvent('skyward:pickup', (value) => this.notify(`${this.playerName((value as { playerId: string }).playerId)} 获得了增益`)),
      parti.onEvent('skyward:death', (value) => this.notify(`${this.playerName((value as { playerId: string }).playerId)} 倒下了`)),
      parti.onEvent('skyward:boss-defeated', () => this.notify('天空之门开启！')),
      parti.onEvent('skyward:shield', () => this.notify('团队护盾挡住了伤害')),
      parti.onEvent('skyward:shot', (value) => this.spawnRemoteShot(value as { shotId: string; playerId: string; x: number; y: number; spread: boolean; power: boolean })),
    );
    mainCanvas.addEventListener('pointerdown', this.onPointerDown);
    mainCanvas.addEventListener('pointerup', this.onPointerUp);
    mainCanvas.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('pagehide', this.destroy, { once: true });
    parti.ready();
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.04, Math.max(0.001, (now - this.previousTime) / 1000));
    this.previousTime = now;
    this.pixelRatio = mainCanvas.width / Math.max(1, mainCanvas.clientWidth);
    this.viewport = this.computeViewport();
    if (!this.state || (this.state.phase !== 'running' && this.state.phase !== 'boss')) return;
    const me = this.me();
    if (!me) return;
    for (const player of Object.values(this.state.players)) {
      if (player.id === parti.playerId) continue;
      const visual = this.remoteVisuals[player.id] ??= { x: player.x, y: player.y };
      visual.x = (visual.x + this.wrapDelta(visual.x, player.x) * Math.min(1, dt * 9) + WORLD_WIDTH) % WORLD_WIDTH;
      visual.y += (player.y - visual.y) * Math.min(1, dt * 9);
    }
    if (!me.alive || this.pendingDeath || !this.local.alive) return;
    this.updateDirection();
    this.simulatePlayer(dt);
    if (this.local.y < this.state.teamVoidY - 60) { this.reportLocalDeath('void'); return; }
    this.simulateBullets(dt);
    this.checkWorldInteractions(now);
    if (now >= this.telemetryAt) {
      this.telemetryAt = now + 220;
      void parti.action('telemetry', { x: this.local.x, y: this.local.y, vy: this.local.vy, cameraBottom: this.local.cameraBottom });
    }
  }

  render() {
    const context = mainContext;
    const width = mainCanvas.width / this.pixelRatio;
    const height = mainCanvas.height / this.pixelRatio;
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#07131f'; context.fillRect(0, 0, width, height);
    this.uiHits = [];
    const view = this.viewport;
    context.save(); context.beginPath(); context.rect(view.x, view.y, view.w, view.h); context.clip();
    this.drawWorld();
    context.restore();
    this.drawHud(width, height);
    if (!this.state) this.overlay('正在连接云端...', '');
    else if (this.state.phase === 'lobby') this.drawLobby();
    else if (this.state.phase === 'gameover') this.drawGameOver();
    this.drawFlash(width);
    context.restore();
  }

  private receiveState(state: GameState) {
    const previousPhase = this.state?.phase;
    this.state = state;
    const me = this.me();
    if (!me) return;
    if (previousPhase === 'lobby' && state.phase === 'running') {
      this.chunks.clear(); this.bullets = []; this.pendingDefeatedEnemies.clear();
    }
    for (const enemyId of state.defeatedEnemies) this.pendingDefeatedEnemies.delete(enemyId);
    if ((state.phase === 'running' || state.phase === 'boss') && me.positionEpoch !== this.appliedPositionEpoch) {
      this.appliedPositionEpoch = me.positionEpoch;
      this.pendingDeath = false;
      this.local = {
        x: me.x,
        y: me.y,
        vy: me.vy || JUMP_SPEED,
        cameraBottom: me.cameraBottom,
        viewBottom: Math.max(state.teamVoidY, me.y - VIEW_HEIGHT * .35),
        alive: true,
      };
    }
    if (!me.alive) { this.pendingDeath = false; this.local.alive = false; }
    else if (!this.pendingDeath) this.local.alive = true;
  }

  private simulatePlayer(dt: number) {
    const previousY = this.local.y;
    this.local.x = (this.local.x + this.direction * MOVE_SPEED * dt + WORLD_WIDTH) % WORLD_WIDTH;
    this.local.vy += GRAVITY * dt;
    this.local.y += this.local.vy * dt;
    if (this.local.vy <= 0) {
      const platforms = this.visibleChunks().flatMap((chunk) => chunk.platforms).filter((item) => item.kind !== 'relay-bridge' || this.state!.activeRelays.includes(`relay:${item.id.split(':')[0]}`));
      const landing = platforms.find((item) => previousY - PLAYER_RADIUS >= item.y && this.local.y - PLAYER_RADIUS <= item.y && Math.abs(this.local.x - item.x) <= item.width / 2 + PLAYER_RADIUS * 0.45);
      if (landing) {
        this.local.y = landing.y + PLAYER_RADIUS; this.local.vy = JUMP_SPEED;
        if (landing.kind === 'relay-trigger') void parti.action('activateRelay', { chunkIndex: Number(landing.id.split(':')[0]) });
      }
    }
    this.local.cameraBottom = Math.max(this.local.cameraBottom, this.local.y - VIEW_HEIGHT * 0.56);
    const upperLine = this.local.viewBottom + VIEW_HEIGHT * .56;
    const lowerLine = this.local.viewBottom + VIEW_HEIGHT * .28;
    if (this.local.y > upperLine) this.local.viewBottom = this.local.y - VIEW_HEIGHT * .56;
    else if (this.local.y < lowerLine) this.local.viewBottom = this.local.y - VIEW_HEIGHT * .28;
    this.local.viewBottom = Math.max(this.state?.teamVoidY ?? 0, this.local.viewBottom);
  }

  private simulateBullets(dt: number) {
    for (const bullet of this.bullets) { bullet.y += bullet.vy * dt; bullet.life -= dt; }
    this.bullets = this.bullets.filter((bullet) => bullet.life > 0 && bullet.y < this.local.viewBottom + VIEW_HEIGHT + 200);
    for (const bullet of this.bullets) {
      if (bullet.cosmetic) continue;
      if (this.state?.boss) {
        const bossY = gateY(this.state.boss.gate) + 270;
        if (Math.abs(bullet.x - WORLD_WIDTH / 2) < 150 && Math.abs(bullet.y - bossY) < 130) {
          bullet.life = 0;
          void parti.action('resolveHit', { shotId: bullet.shotId, projectileIndex: bullet.projectileIndex, targetId: `boss:${this.state.boss.gate}` });
          continue;
        }
      }
      const enemy = this.activeEnemies().find((item) => Math.abs(bullet.x - item.x) < 44 && Math.abs(bullet.y - item.y) < 55);
      if (enemy) { bullet.life = 0; void parti.action('resolveHit', { shotId: bullet.shotId, projectileIndex: bullet.projectileIndex, targetId: enemy.id }); }
    }
  }

  private checkWorldInteractions(now: number) {
    const me = this.me(); if (!me) return;
    for (const enemy of this.activeEnemies()) {
      const dx = Math.abs(this.local.x - enemy.x); const dy = this.local.y - enemy.y;
      if (dx < 55 && Math.abs(dy) < 70) {
        if (this.local.vy < -80 && dy > 0) {
          this.local.vy = JUMP_SPEED;
          this.pendingDefeatedEnemies.add(enemy.id);
          void parti.action('stomp', { enemyId: enemy.id });
        }
        else if (now > this.hitAt && (this.me()?.invulnerableUntil ?? 0) <= Date.now()) {
          this.hitAt = now + 1200;
          if (this.state?.teamBuffs.includes('team-shield')) void parti.action('reportDeath', { reason: 'enemy' });
          else this.reportLocalDeath('enemy');
        }
      }
    }
    for (const pickup of this.activePickups()) {
      if (Math.abs(this.local.x - pickup.x) < 58 && Math.abs(this.local.y - pickup.y) < 70) void parti.action('claimPickup', { pickupId: pickup.id });
    }
  }

  private shoot() {
    if (!this.me()?.alive || !this.local.alive || this.pendingDeath || performance.now() < this.shotAt) return;
    const rapid = this.me()?.buffs.includes('rapid');
    this.shotAt = performance.now() + (rapid ? 110 : 240);
    const shotId = `${parti.playerId ?? 'player'}:${Date.now().toString(36)}:${(this.shotSequence += 1).toString(36)}`;
    const color = this.me()?.buffs.includes('power') ? '#ff9b73' : '#fff7a8';
    this.bullets.push({ shotId, projectileIndex: 0, x: this.local.x, y: this.local.y + 40, vy: 1050, life: 1.5, cosmetic: false, color });
    if (this.me()?.buffs.includes('spread')) {
      this.bullets.push(
        { shotId, projectileIndex: 1, x: this.local.x - 24, y: this.local.y + 30, vy: 930, life: 1.5, cosmetic: false, color },
        { shotId, projectileIndex: 2, x: this.local.x + 24, y: this.local.y + 30, vy: 930, life: 1.5, cosmetic: false, color },
      );
    }
    void parti.action('shoot', { shotId, x: this.local.x, y: this.local.y });
  }

  private visibleChunks() {
    if (!this.state) return [];
    if (this.state.phase === 'lobby' || this.state.phase === 'gameover') return [];
    const start = Math.max(0, Math.floor(this.local.viewBottom / CHUNK_HEIGHT) - 1);
    const end = Math.floor((this.local.viewBottom + VIEW_HEIGHT) / CHUNK_HEIGHT) + 1;
    const playerCount = Math.max(1, this.state.startedPlayers.length);
    const result: TerrainChunk[] = [];
    for (let index = start; index <= end; index += 1) {
      let chunk = this.chunks.get(index);
      if (!chunk) { chunk = generateChunk(this.state.seed, index, playerCount); this.chunks.set(index, chunk); }
      result.push(chunk);
    }
    return result;
  }

  private activeEnemies(): EnemySpawn[] {
    const defeated = new Set(this.state?.defeatedEnemies ?? []);
    return this.visibleChunks().flatMap((chunk) => chunk.enemies).filter((enemy) => !defeated.has(enemy.id) && !this.pendingDefeatedEnemies.has(enemy.id));
  }

  private activePickups(): PickupSpawn[] {
    const claimed = new Set(this.state?.claimedPickups ?? []);
    return this.visibleChunks().flatMap((chunk) => chunk.pickups).filter((pickup) => !claimed.has(pickup.id));
  }

  private drawWorld() {
    const context = mainContext; const view = this.viewport;
    const biome = biomeFor(Math.max(0, Math.floor(this.local.viewBottom / CHUNK_HEIGHT)));
    const gradient = context.createLinearGradient(0, view.y, 0, view.y + view.h);
    gradient.addColorStop(0, biome.sky); gradient.addColorStop(1, biome.haze);
    context.fillStyle = gradient; context.fillRect(view.x, view.y, view.w, view.h);
    for (let i = 0; i < 18; i += 1) {
      const x = view.x + ((i * 137 + this.local.viewBottom * 0.02) % WORLD_WIDTH) * view.scale;
      const y = view.y + ((i * 241 - this.local.viewBottom * 0.05) % VIEW_HEIGHT + VIEW_HEIGHT) % VIEW_HEIGHT * view.scale;
      context.globalAlpha = 0.26; context.fillStyle = '#fff'; context.beginPath(); context.arc(x, y, (3 + i % 4) * view.scale, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 1;
    for (const chunk of this.visibleChunks()) for (const item of chunk.platforms) {
      if (item.kind !== 'relay-bridge' || this.state?.activeRelays.includes(`relay:${chunk.index}`)) this.drawPlatform(item, biome.platform);
    }
    for (const pickup of this.activePickups()) this.drawPickup(pickup);
    for (const enemy of this.activeEnemies()) this.drawEnemy(enemy);
    if (this.state?.boss) this.drawBoss();
    for (const player of Object.values(this.state?.players ?? {})) if (player.id !== parti.playerId && player.connected) {
      const visual = this.remoteVisuals[player.id] ?? player;
      this.drawPlayer(visual.x, visual.y, player.name.slice(0, 1), '#ffcf70', !player.alive);
    }
    if (this.me()?.alive && this.local.alive) this.drawPlayer(this.local.x, this.local.y, '你', '#fff4b8', false, (this.me()?.invulnerableUntil ?? 0) > Date.now());
    for (const bullet of this.bullets) { const p = this.toScreen(bullet.x, bullet.y); context.fillStyle = bullet.color; context.fillRect(p.x - 5, p.y - 20, 10, 28); }
    if (this.state && this.state.teamVoidY > this.local.viewBottom - 80) {
      const y = this.toScreen(0, this.state.teamVoidY).y; context.fillStyle = 'rgba(10,4,24,.58)'; context.fillRect(view.x, y, view.w, view.y + view.h - y);
    }
  }

  private drawPlatform(item: Platform, color: string) {
    const context = mainContext; const p = this.toScreen(item.x, item.y); const width = item.width * this.viewport.scale;
    context.fillStyle = item.kind === 'gate' ? '#f6ca67' : item.kind.startsWith('relay') ? '#77f2d1' : color;
    context.fillRect(p.x - width / 2, p.y - 12 * this.viewport.scale, width, 24 * this.viewport.scale);
    context.fillStyle = 'rgba(0,0,0,.22)'; context.fillRect(p.x - width / 2, p.y + 8 * this.viewport.scale, width, 9 * this.viewport.scale);
  }

  private drawEnemy(enemy: EnemySpawn) {
    const context = mainContext; const p = this.toScreen(enemy.x, enemy.y); const r = 34 * this.viewport.scale;
    context.fillStyle = enemy.kind === 'spike' ? '#ff6685' : '#25304f'; context.beginPath(); context.arc(p.x, p.y, r, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#fff'; context.fillRect(p.x - r * .45, p.y - r * .2, r * .25, r * .25); context.fillRect(p.x + r * .2, p.y - r * .2, r * .25, r * .25);
  }

  private drawPickup(pickup: PickupSpawn) {
    const context = mainContext; const p = this.toScreen(pickup.x, pickup.y); const r = 28 * this.viewport.scale;
    context.fillStyle = pickup.kind === 'team-shield' ? '#70e1ff' : '#ffdc73'; context.beginPath(); context.arc(p.x, p.y, r, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#172039'; context.font = `700 ${20 * this.viewport.scale}px ${FONT}`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(pickup.kind === 'team-shield' ? '盾' : '✦', p.x, p.y);
  }

  private drawBoss() {
    const boss = this.state!.boss!; const y = gateY(boss.gate) + 270; const p = this.toScreen(WORLD_WIDTH / 2, y); const context = mainContext;
    context.fillStyle = '#5c3ca8'; context.beginPath(); context.arc(p.x, p.y, 120 * this.viewport.scale, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#fff'; context.beginPath(); context.arc(p.x, p.y, 38 * this.viewport.scale, 0, Math.PI * 2); context.fill();
  }

  private drawPlayer(x: number, y: number, label: string, color: string, dead: boolean, invulnerable = false) {
    if (y < this.local.viewBottom || y > this.local.viewBottom + VIEW_HEIGHT) return;
    const context = mainContext; const p = this.toScreen(x, y); const radius = PLAYER_RADIUS * this.viewport.scale;
    if (invulnerable) {
      context.strokeStyle = '#7eeeff'; context.lineWidth = 6 * this.viewport.scale; context.globalAlpha = .75;
      context.beginPath(); context.arc(p.x, p.y, radius + 11 * this.viewport.scale, 0, Math.PI * 2); context.stroke(); context.globalAlpha = 1;
    }
    context.globalAlpha = dead ? .3 : 1; context.fillStyle = color; context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#172039'; context.font = `700 ${17 * this.viewport.scale}px ${FONT}`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, p.x, p.y); context.globalAlpha = 1;
  }

  private drawHud(width: number, height: number) {
    if (!this.state) return;
    const context = mainContext; const view = this.viewport;
    this.text(view.x + 18, view.y + 18, `${Math.floor(this.state.highestY / 100)}m`, 22, '#fff', 800);
    this.text(view.x + 18, view.y + 48, `Boss ${this.state.bossCount}`, 14, 'rgba(255,255,255,.75)', 600);
    const players = this.state.startedPlayers.map((id) => this.state!.players[id]).filter(Boolean);
    players.forEach((player, index) => {
      const x = view.x + 22 + index * 42; const y = view.y + 88;
      context.fillStyle = player.alive ? '#ffe091' : '#7d7892'; context.beginPath(); context.arc(x, y, 15, 0, Math.PI * 2); context.fill();
      this.centerText(player.name.slice(0, 1), x, y, 11, '#172039', 800);
    });
    if (this.state.boss) {
      const ratio = this.state.boss.hp / this.state.boss.maxHp;
      context.fillStyle = 'rgba(10,10,30,.62)'; context.fillRect(view.x + view.w * .18, view.y + 24, view.w * .64, 28);
      context.fillStyle = '#ff6685'; context.fillRect(view.x + view.w * .18 + 4, view.y + 28, (view.w * .64 - 8) * ratio, 20);
      this.centerText(this.state.boss.name, view.x + view.w / 2, view.y + 38, 13, '#fff', 700);
    }
    if ((this.state.phase === 'running' || this.state.phase === 'boss') && this.me()) {
      const fireX = view.x + view.w - 70; const fireY = view.y + view.h - 84;
      context.fillStyle = 'rgba(255,207,112,.88)'; context.beginPath(); context.arc(fireX, fireY, 46, 0, Math.PI * 2); context.fill();
      this.centerText('开火', fireX, fireY, 16, '#172039', 800);
      this.uiHits.push({ x: fireX - 58, y: fireY - 58, w: 116, h: 116, action: () => this.shoot() });
      if ('DeviceOrientationEvent' in window) this.button(view.x + view.w - 112, view.y + 66, 94, 34, this.tiltEnabled ? '重力 ✓' : '重力', () => void this.toggleTilt());
      const me = this.me()!;
      if (!me.alive && me.respawnAt) this.overlay('正在返回云端', `${Math.max(0, Math.ceil((me.respawnAt - Date.now()) / 1000))} 秒`);
      else if (this.pendingDeath) this.overlay('正在坠入云海', '同步远征状态…');
    }
    if (width > view.w + 40) {
      context.fillStyle = 'rgba(255,255,255,.2)'; context.font = `600 13px ${FONT}`; context.textAlign = 'center'; context.fillText('固定 9:16 公平视野', width / 2, height - 14);
    }
  }

  private drawLobby() {
    const me = this.me(); const players = Object.values(this.state!.players);
    this.overlay('云端远征', '所有成员准备后出发');
    const centerX = this.viewport.x + this.viewport.w / 2;
    const best = this.state!.bestRun;
    this.centerText(best.height > 0 ? `最高纪录 ${Math.floor(best.height / 100)}m · ${best.bosses} Boss` : '最高纪录等待创造', centerX, this.viewport.y + this.viewport.h * .42, 16, '#ffdf8c', 700);
    let y = this.viewport.y + this.viewport.h * .48;
    for (const player of players) { this.centerText(`${player.ready ? '✓' : '○'} ${player.name}${player.id === parti.playerId ? '（你）' : ''}`, centerX, y, 17, player.ready ? '#93f4bf' : '#fff'); y += 34; }
    if (me) this.button(centerX - 80, this.viewport.y + this.viewport.h * .7, 160, 52, me.ready ? '取消准备' : '准备出发', () => void parti.action('setReady', { ready: !me.ready }));
  }

  private drawGameOver() {
    this.overlay('远征结束', `团队高度 ${Math.floor(this.state!.highestY / 100)}m · 击败 ${this.state!.bossCount} 个Boss`);
    const sorted = this.state!.startedPlayers.map((id) => this.state!.players[id]).sort((a, b) => b.kills - a.kills);
    sorted.forEach((player, index) => this.centerText(`${player.name}  击杀 ${player.kills} · 倒下 ${player.deaths} · 射击 ${player.shots}`, this.viewport.x + this.viewport.w / 2, this.viewport.y + this.viewport.h * .52 + index * 34, 16, '#fff'));
    if (parti.playerId === this.state!.hostId) {
      this.button(this.viewport.x + this.viewport.w / 2 - 90, this.viewport.y + this.viewport.h * .72, 180, 52, '返回准备', () => void parti.action('restart'));
    } else {
      this.centerText('等待房主重新开始', this.viewport.x + this.viewport.w / 2, this.viewport.y + this.viewport.h * .74, 15, '#d8eaff');
    }
  }

  private overlay(title: string, subtitle: string) {
    const context = mainContext; const v = this.viewport;
    context.fillStyle = 'rgba(7,13,30,.72)'; context.fillRect(v.x, v.y, v.w, v.h);
    this.centerText(title, v.x + v.w / 2, v.y + v.h * .32, 34, '#fff4b8', 900);
    if (subtitle) this.centerText(subtitle, v.x + v.w / 2, v.y + v.h * .38, 16, '#d8eaff', 500);
  }

  private button(x: number, y: number, w: number, h: number, label: string, action: () => void) {
    const context = mainContext; context.fillStyle = '#ffcf70'; context.fillRect(x, y, w, h); context.strokeStyle = '#fff0bd'; context.lineWidth = 2; context.strokeRect(x + 1, y + 1, w - 2, h - 2);
    this.centerText(label, x + w / 2, y + h / 2, 16, '#172039', 800); this.uiHits.push({ x, y, w, h, action });
  }

  private drawFlash(width: number) {
    if (!this.flash || performance.now() > this.flashUntil) return;
    const context = mainContext; context.fillStyle = 'rgba(10,14,35,.88)'; context.fillRect(width / 2 - 150, this.viewport.y + 130, 300, 42);
    this.centerText(this.flash, width / 2, this.viewport.y + 151, 15, '#fff', 700);
  }

  private updateDirection() {
    const touch = [...this.touchDirections.values()].at(-1) ?? 0;
    const next = this.tiltEnabled ? this.tiltDirection : touch || this.keyDirection;
    if (next === this.direction) return;
    this.direction = next; void parti.action('move', { direction: next });
  }

  private onPointerDown = (event: PointerEvent) => {
    const point = this.pointerPoint(event); const hit = [...this.uiHits].reverse().find((item) => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h);
    if (hit) { hit.action(); return; }
    if (!this.state || (this.state.phase !== 'running' && this.state.phase !== 'boss')) return;
    if (!this.local.alive || this.pendingDeath) return;
    mainCanvas.setPointerCapture(event.pointerId);
    this.touchDirections.set(event.pointerId, point.x < this.viewport.x + this.viewport.w / 2 ? -1 : 1);
  };

  private onPointerUp = (event: PointerEvent) => { this.touchDirections.delete(event.pointerId); };
  private onKey = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space'].includes(event.code)) return;
    if (event.code === 'Space' && event.type === 'keydown' && !event.repeat) { this.shoot(); event.preventDefault(); return; }
    const pressed = event.type === 'keydown';
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.keyDirection = pressed ? -1 : this.keyDirection === -1 ? 0 : this.keyDirection;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') this.keyDirection = pressed ? 1 : this.keyDirection === 1 ? 0 : this.keyDirection;
  };

  private onOrientation = (event: DeviceOrientationEvent) => {
    if (!this.tiltEnabled || event.gamma == null) return;
    this.tiltDirection = event.gamma < -5 ? -1 : event.gamma > 5 ? 1 : 0;
  };

  private async toggleTilt() {
    if (!this.tiltEnabled) {
      const Orientation = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (Orientation.requestPermission && await Orientation.requestPermission() !== 'granted') { this.notify('未获得重力感应权限'); return; }
    }
    this.tiltEnabled = !this.tiltEnabled; this.tiltDirection = 0;
    void parti.action('enableTilt', { enabled: this.tiltEnabled });
  }

  private spawnRemoteShot(shot: { shotId: string; playerId: string; x: number; y: number; spread: boolean; power: boolean }) {
    if (shot.playerId === parti.playerId) return;
    const color = shot.power ? '#ff9b73' : '#8fe9ff';
    this.bullets.push({ shotId: shot.shotId, projectileIndex: 0, x: shot.x, y: shot.y + 40, vy: 1050, life: 1.5, cosmetic: true, color });
    if (shot.spread) {
      this.bullets.push(
        { shotId: shot.shotId, projectileIndex: 1, x: shot.x - 24, y: shot.y + 30, vy: 930, life: 1.5, cosmetic: true, color },
        { shotId: shot.shotId, projectileIndex: 2, x: shot.x + 24, y: shot.y + 30, vy: 930, life: 1.5, cosmetic: true, color },
      );
    }
  }

  private reportLocalDeath(reason: 'void' | 'enemy') {
    if (this.pendingDeath || !this.local.alive) return;
    this.pendingDeath = true;
    this.local.alive = false;
    this.direction = 0;
    this.touchDirections.clear();
    void parti.action('move', { direction: 0 });
    void parti.action('reportDeath', { reason });
  }

  private pointerPoint(event: PointerEvent) { const rect = mainCanvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  private computeViewport(): Viewport {
    const width = mainCanvas.width / this.pixelRatio; const height = mainCanvas.height / this.pixelRatio;
    const scale = Math.min(width / WORLD_WIDTH, height / VIEW_HEIGHT); const w = WORLD_WIDTH * scale; const h = VIEW_HEIGHT * scale;
    return { x: (width - w) / 2, y: (height - h) / 2, w, h, scale };
  }
  private toScreen(x: number, y: number) { return { x: this.viewport.x + x * this.viewport.scale, y: this.viewport.y + this.viewport.h - (y - this.local.viewBottom) * this.viewport.scale }; }
  private wrapDelta(from: number, to: number) { let delta = to - from; if (delta > WORLD_WIDTH / 2) delta -= WORLD_WIDTH; if (delta < -WORLD_WIDTH / 2) delta += WORLD_WIDTH; return delta; }
  private me(): PublicPlayer | null { return this.state && parti.playerId ? this.state.players[parti.playerId] ?? null : null; }
  private playerName(id: string) { return this.state?.players[id]?.name ?? '队友'; }
  private notify(message: string) { this.flash = message; this.flashUntil = performance.now() + 1600; }
  private text(x: number, y: number, value: string, size: number, color: string, weight = 400) { const c = mainContext; c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(value, x, y); }
  private centerText(value: string, x: number, y: number, size: number, color: string, weight = 400) { const c = mainContext; c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, x, y); }
  private destroy = () => {
    for (const dispose of this.disposers.splice(0)) dispose();
    mainCanvas.removeEventListener('pointerdown', this.onPointerDown); mainCanvas.removeEventListener('pointerup', this.onPointerUp); mainCanvas.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey); window.removeEventListener('deviceorientation', this.onOrientation);
  };
}
