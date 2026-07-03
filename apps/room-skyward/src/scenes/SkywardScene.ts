import { mainCanvas, mainContext } from 'littlejsengine';
import { animationFrame, assets, characterSkinForIndex, enemySkins, PICKUP_VISUALS, projectileVariant, projectileVisuals, themeForBiome, uiThemes, type BiomeTheme, type ProjectileVariant } from '../assets/catalog';
import { SoundPlayer } from '../assets/registry';
import { GRAVITY, JUMP_SPEED, MOVE_SPEED } from '../game/physics';
import { CHUNK_HEIGHT, PLAYER_RADIUS, VIEW_HEIGHT, WORLD_WIDTH, type EnemySpawn, type GameState, type PickupSpawn, type Platform, type PublicPlayer, type TerrainChunk } from '../game/types';
import { biomeFor, gateY, generateChunk, isBossExitActive } from '../game/world';

type Bullet = { shotId: string; projectileIndex: number; x: number; y: number; vy: number; life: number; cosmetic: boolean; color: string; variant: ProjectileVariant };
type UiHit = { x: number; y: number; w: number; h: number; action: () => void };
type Viewport = { x: number; y: number; w: number; h: number; scale: number };

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
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
  private sounds = new SoundPlayer(assets);
  private pressedUntil = 0;
  private bossHitUntil = 0;
  private soundEnabled = this.readSoundPreference();

  init() {
    this.sounds.setEnabled(this.soundEnabled);
    this.disposers.push(
      parti.onState((value) => this.receiveState(value as GameState)),
      parti.onEvent('skyward:pickup', (value) => { this.sounds.play('sound.pickup', 140); this.notify(`${this.playerName((value as { playerId: string }).playerId)} 获得了增益`); }),
      parti.onEvent('skyward:death', (value) => { this.sounds.play('sound.hurt', 250); this.notify(`${this.playerName((value as { playerId: string }).playerId)} 倒下了`); }),
      parti.onEvent('skyward:boss-defeated', () => { this.sounds.play('sound.vanish', 300); this.notify('天空之门开启！'); }),
      parti.onEvent('skyward:shield', () => { this.sounds.play('sound.select', 180); this.notify('团队护盾挡住了伤害'); }),
      parti.onEvent('skyward:shot', (value) => this.spawnRemoteShot(value as { shotId: string; playerId: string; x: number; y: number; spread: boolean; power: boolean })),
    );
    void assets.preloadImages();
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
      const platforms = this.visibleChunks().flatMap((chunk) => chunk.platforms).filter((item) => this.isPlatformActive(item));
      const landing = platforms.find((item) => previousY - PLAYER_RADIUS >= item.y && this.local.y - PLAYER_RADIUS <= item.y && Math.abs(this.local.x - item.x) <= item.width / 2 + PLAYER_RADIUS * 0.45);
      if (landing) {
          this.local.y = landing.y + PLAYER_RADIUS; this.local.vy = JUMP_SPEED; this.sounds.play('sound.jump', 150, .22);
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
          this.bossHitUntil = performance.now() + 110;
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
    const power = this.me()?.buffs.includes('power') ?? false;
    this.bullets.push({ shotId, projectileIndex: 0, x: this.local.x, y: this.local.y + 40, vy: 1050, life: 1.5, cosmetic: false, color, variant: projectileVariant(power, 0) });
    if (this.me()?.buffs.includes('spread')) {
      this.bullets.push(
        { shotId, projectileIndex: 1, x: this.local.x - 24, y: this.local.y + 30, vy: 930, life: 1.5, cosmetic: false, color, variant: projectileVariant(power, 1) },
        { shotId, projectileIndex: 2, x: this.local.x + 24, y: this.local.y + 30, vy: 930, life: 1.5, cosmetic: false, color, variant: projectileVariant(power, 2) },
      );
    }
    void parti.action('shoot', { shotId, x: this.local.x, y: this.local.y });
    this.sounds.play('sound.shoot', 80, .22);
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
    const theme = themeForBiome(biome.id);
    const gradient = context.createLinearGradient(0, view.y, 0, view.y + view.h);
    gradient.addColorStop(0, biome.sky); gradient.addColorStop(1, biome.haze);
    context.fillStyle = gradient; context.fillRect(view.x, view.y, view.w, view.h);
    const background = assets.image(theme.background);
    if (background) {
      context.globalAlpha = .58;
      const ratio = background.naturalWidth / Math.max(1, background.naturalHeight);
      const h = view.h * .42; const w = h * ratio;
      for (let x = view.x - ((this.local.viewBottom * .025) % w); x < view.x + view.w; x += w) context.drawImage(background, x, view.y + view.h - h, w, h);
      context.globalAlpha = 1;
    }
    for (let i = 0; i < 18; i += 1) {
      const x = view.x + ((i * 137 + this.local.viewBottom * 0.02) % WORLD_WIDTH) * view.scale;
      const y = view.y + ((i * 241 - this.local.viewBottom * 0.05) % VIEW_HEIGHT + VIEW_HEIGHT) % VIEW_HEIGHT * view.scale;
      context.globalAlpha = 0.26; context.fillStyle = '#fff'; context.beginPath(); context.arc(x, y, (3 + i % 4) * view.scale, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 1;
    for (const chunk of this.visibleChunks()) for (const item of chunk.platforms) if (this.isPlatformActive(item)) this.drawPlatform(item, theme, biome.platform);
    for (const pickup of this.activePickups()) this.drawPickup(pickup);
    for (const enemy of this.activeEnemies()) this.drawEnemy(enemy);
    if (this.state?.boss) this.drawBoss();
    for (const player of Object.values(this.state?.players ?? {})) if (player.id !== parti.playerId && player.connected) {
      const visual = this.remoteVisuals[player.id] ?? player;
      this.drawPlayer(visual.x, visual.y, player, this.playerIndex(player.id), false);
    }
    if (this.me()?.alive && this.local.alive) this.drawPlayer(this.local.x, this.local.y, this.me()!, this.playerIndex(parti.playerId!), true, (this.me()?.invulnerableUntil ?? 0) > Date.now());
    for (const bullet of this.bullets) this.drawBullet(bullet);
    if (this.state && this.state.teamVoidY > this.local.viewBottom - 80) {
      const y = this.toScreen(0, this.state.teamVoidY).y; context.fillStyle = 'rgba(10,4,24,.58)'; context.fillRect(view.x, y, view.w, view.y + view.h - y);
    }
  }

  private drawPlatform(item: Platform, theme: BiomeTheme, fallbackColor: string) {
    const context = mainContext; const p = this.toScreen(item.x, item.y); const width = item.width * this.viewport.scale; const height = 72 * this.viewport.scale;
    const terrain = item.kind.startsWith('relay') ? { left: theme.relay, middle: theme.relay, right: theme.relay } : theme.terrain;
    const left = assets.image(terrain.left); const middle = assets.image(terrain.middle); const right = assets.image(terrain.right);
    if (!left || !middle || !right) {
      context.fillStyle = item.kind === 'gate' ? '#f6ca67' : item.kind.startsWith('relay') ? '#77f2d1' : fallbackColor;
      context.fillRect(p.x - width / 2, p.y - 12 * this.viewport.scale, width, 24 * this.viewport.scale);
      return;
    }
    const cap = Math.min(64 * this.viewport.scale, width / 3); const start = p.x - width / 2;
    // Kenney horizontal terrain has an 8 px transparent top inset. Align its visible
    // surface with Platform.y, which is also the physics landing plane.
    const textureTop = p.y - height * (8 / 128);
    context.drawImage(left, start, textureTop, cap, height);
    const innerStart = start + cap; const innerEnd = start + width - cap;
    for (let x = innerStart; x < innerEnd; x += cap) context.drawImage(middle, 0, 0, middle.naturalWidth, middle.naturalHeight, x, textureTop, Math.min(cap, innerEnd - x), height);
    context.drawImage(right, start + width - cap, textureTop, cap, height);
    if (item.kind === 'gate') {
      const gate = assets.image(theme.gate);
      if (gate) context.drawImage(gate, p.x - 50 * this.viewport.scale, p.y - 112 * this.viewport.scale, 100 * this.viewport.scale, 112 * this.viewport.scale);
    }
  }

  private drawBullet(bullet: Bullet) {
    const context = mainContext; const p = this.toScreen(bullet.x, bullet.y); const visual = projectileVisuals.require(bullet.variant); const image = assets.image(visual.image); const size = visual.size * this.viewport.scale;
    context.save(); context.shadowColor = visual.glow; context.shadowBlur = Math.max(3, size * .65);
    if (image) context.drawImage(image, p.x - size / 2, p.y - size / 2, size, size);
    else { context.fillStyle = bullet.color; context.beginPath(); context.arc(p.x, p.y, size / 2, 0, Math.PI * 2); context.fill(); }
    context.restore();
  }

  private drawEnemy(enemy: EnemySpawn) {
    const context = mainContext; const p = this.toScreen(enemy.x, enemy.y); const skin = enemySkins.require(enemy.kind);
    const id = animationFrame(skin.move, performance.now(), 260); const sprite = assets.image(id); const size = 88 * skin.scale * this.viewport.scale;
    const platform = this.platformFor(enemy.platformId); const surfaceY = platform ? this.toScreen(platform.x, platform.y).y : p.y + 72 * this.viewport.scale;
    if (sprite) { context.drawImage(sprite, p.x - size / 2, surfaceY - size + size * skin.bottomInset, size, size); return; }
    const r = 34 * this.viewport.scale; context.fillStyle = enemy.kind === 'spike' ? '#ff6685' : '#25304f'; context.beginPath(); context.arc(p.x, surfaceY - r, r, 0, Math.PI * 2); context.fill();
  }

  private drawPickup(pickup: PickupSpawn) {
    const context = mainContext; const p = this.toScreen(pickup.x, pickup.y); const visual = PICKUP_VISUALS[pickup.kind]; const sprite = assets.image(visual.icon);
    const pulse = 1 + Math.sin(performance.now() / 180) * .08; const size = visual.size * this.viewport.scale * pulse;
    const platform = this.platformFor(pickup.platformId); const surfaceY = platform ? this.toScreen(platform.x, platform.y).y : p.y + 76 * this.viewport.scale;
    const visualBottom = surfaceY - visual.hover * this.viewport.scale; const top = visualBottom - size + size * visual.bottomInset;
    context.save(); context.shadowColor = pickup.kind === 'team-shield' ? '#70e1ff' : '#ffdc73'; context.shadowBlur = 18 * this.viewport.scale;
    if (sprite) context.drawImage(sprite, p.x - size / 2, top, size, size);
    else { context.fillStyle = '#ffdc73'; context.beginPath(); context.arc(p.x, visualBottom - size / 2, size / 2, 0, Math.PI * 2); context.fill(); }
    context.restore();
  }

  private drawBoss() {
    const boss = this.state!.boss!; const y = gateY(boss.gate) + 270; const p = this.toScreen(WORLD_WIDTH / 2, y); const context = mainContext;
    const skin = enemySkins.require('boss'); const sprite = assets.image(animationFrame(skin.move, performance.now(), 300));
    const bob = Math.sin(performance.now() / 280) * 8 * this.viewport.scale; const size = 118 * skin.scale * this.viewport.scale;
    context.save(); context.shadowColor = '#ff665f'; context.shadowBlur = 28 * this.viewport.scale; context.globalAlpha = performance.now() < this.bossHitUntil ? .35 : 1;
    if (sprite) context.drawImage(sprite, p.x - size / 2, p.y - size / 2 + bob + (skin.offsetY ?? 0) * this.viewport.scale, size, size);
    else { context.fillStyle = '#5c3ca8'; context.beginPath(); context.arc(p.x, p.y, 120 * this.viewport.scale, 0, Math.PI * 2); context.fill(); }
    context.restore();
  }

  private drawPlayer(x: number, y: number, player: PublicPlayer, index: number, local: boolean, invulnerable = false) {
    if (y < this.local.viewBottom || y > this.local.viewBottom + VIEW_HEIGHT) return;
    const context = mainContext; const p = this.toScreen(x, y); const radius = PLAYER_RADIUS * this.viewport.scale; const skin = characterSkinForIndex(index);
    if (invulnerable) {
      context.strokeStyle = '#7eeeff'; context.lineWidth = 6 * this.viewport.scale; context.globalAlpha = .75;
      context.beginPath(); context.arc(p.x, p.y, radius + 11 * this.viewport.scale, 0, Math.PI * 2); context.stroke(); context.globalAlpha = 1;
    }
    const direction = local ? this.direction : player.direction; const vy = local ? this.local.vy : player.vy;
    const assetId = !player.alive ? skin.hit : Math.abs(vy) > 100 ? skin.jump : direction ? animationFrame(skin.walk, performance.now()) : skin.idle;
    const sprite = assets.image(assetId); const size = 92 * skin.scale * this.viewport.scale;
    context.save(); context.globalAlpha = player.alive ? 1 : .3; context.translate(p.x, p.y); context.scale(direction < 0 ? -1 : 1, 1);
    if (sprite) context.drawImage(sprite, -size / 2, -size * .58, size, size);
    else { context.fillStyle = '#fff4b8'; context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill(); }
    context.restore();
    this.centerText(local ? '你' : player.name, p.x, p.y - size * .72, 12, '#fff', 800);
  }

  private drawHud(width: number, height: number) {
    if (!this.state) return;
    const context = mainContext; const view = this.viewport; const ui = uiThemes.require('default');
    this.panel(view.x + 14, view.y + 14, 132, 70, 15, .86);
    this.drawIcon(ui.icons.height, view.x + 28, view.y + 25, 25);
    this.text(view.x + 58, view.y + 20, `${Math.floor(this.state.highestY / 100)}m`, 21, ui.colors.text, 800);
    this.drawIcon(ui.icons.boss, view.x + 29, view.y + 53, 22);
    this.text(view.x + 58, view.y + 51, `Boss ${this.state.bossCount}`, 13, ui.colors.muted, 700);
    const players = this.state.startedPlayers.map((id) => this.state!.players[id]).filter(Boolean);
    players.forEach((player, index) => {
      const x = view.x + 29 + index * 43; const y = view.y + 105; const avatar = assets.image(characterSkinForIndex(index).avatar);
      context.save(); context.globalAlpha = player.alive ? 1 : .35; context.fillStyle = '#102237cc'; context.beginPath(); context.arc(x, y, 18, 0, Math.PI * 2); context.fill();
      if (avatar) context.drawImage(avatar, x - 15, y - 15, 30, 30); context.restore();
    });
    if (this.state.boss) {
      const ratio = this.state.boss.hp / this.state.boss.maxHp;
      const bx = view.x + view.w * .2; const bw = view.w * .6;
      this.panel(bx, view.y + 20, bw, 36, 14, .82);
      this.roundRect(bx + 5, view.y + 43, (bw - 10) * ratio, 8, 4, ui.colors.danger);
      this.centerText(this.state.boss.name, view.x + view.w / 2, view.y + 34, 13, ui.colors.text, 800);
    }
    if ((this.state.phase === 'running' || this.state.phase === 'boss') && this.me()) {
      const fireX = view.x + view.w - 70; const fireY = view.y + view.h - 84;
      context.save(); context.shadowColor = '#ffd166'; context.shadowBlur = 18; context.fillStyle = 'rgba(19,41,67,.78)'; context.beginPath(); context.arc(fireX, fireY, 51, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#ffd166'; context.lineWidth = 4; context.stroke(); context.restore();
      this.drawIcon(ui.icons.fire, fireX - 22, fireY - 28, 44);
      this.centerText('开火', fireX, fireY + 29, 11, ui.colors.text, 800);
      this.uiHits.push({ x: fireX - 58, y: fireY - 58, w: 116, h: 116, action: () => this.shoot() });
      const controlY = view.y + 18;
      this.iconButton(view.x + view.w - 52, controlY, 'sound', this.soundEnabled, () => this.toggleSound());
      if ('DeviceOrientationEvent' in window) this.iconButton(view.x + view.w - 100, controlY, 'tilt', this.tiltEnabled, () => void this.toggleTilt());
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
    this.overlay('云端远征', '所有成员准备后出发', .72);
    const centerX = this.viewport.x + this.viewport.w / 2;
    const best = this.state!.bestRun;
    this.centerText(best.height > 0 ? `最高纪录 ${Math.floor(best.height / 100)}m · ${best.bosses} Boss` : '最高纪录等待创造', centerX, this.viewport.y + this.viewport.h * .42, 16, '#ffdf8c', 700);
    let y = this.viewport.y + this.viewport.h * .48;
    for (const player of players) { this.centerText(`${player.ready ? '✓' : '○'} ${player.name}${player.id === parti.playerId ? '（你）' : ''}`, centerX, y, 17, player.ready ? '#93f4bf' : '#fff'); y += 34; }
    if (me) this.button(centerX - 80, this.viewport.y + this.viewport.h * .7, 160, 52, me.ready ? '取消准备' : '准备出发', () => void parti.action('setReady', { ready: !me.ready }));
  }

  private drawGameOver() {
    this.overlay('远征结束', `团队高度 ${Math.floor(this.state!.highestY / 100)}m · 击败 ${this.state!.bossCount} 个Boss`, .78);
    const sorted = this.state!.startedPlayers.map((id) => this.state!.players[id]).sort((a, b) => b.kills - a.kills);
    sorted.forEach((player, index) => this.centerText(`${player.name}  击杀 ${player.kills} · 倒下 ${player.deaths} · 射击 ${player.shots}`, this.viewport.x + this.viewport.w / 2, this.viewport.y + this.viewport.h * .52 + index * 34, 16, '#fff'));
    if (parti.playerId === this.state!.hostId) {
      this.button(this.viewport.x + this.viewport.w / 2 - 90, this.viewport.y + this.viewport.h * .72, 180, 52, '返回准备', () => void parti.action('restart'));
    } else {
      this.centerText('等待房主重新开始', this.viewport.x + this.viewport.w / 2, this.viewport.y + this.viewport.h * .74, 15, '#d8eaff');
    }
  }

  private overlay(title: string, subtitle: string, opacity = .72) {
    const context = mainContext; const v = this.viewport;
    context.fillStyle = `rgba(7,13,30,${opacity})`; context.fillRect(v.x, v.y, v.w, v.h);
    this.panel(v.x + v.w * .12, v.y + v.h * .23, v.w * .76, v.h * .56, 26, .94);
    this.centerText(title, v.x + v.w / 2, v.y + v.h * .32, 34, '#fff4b8', 900);
    if (subtitle) this.centerText(subtitle, v.x + v.w / 2, v.y + v.h * .38, 16, '#d8eaff', 500);
  }

  private button(x: number, y: number, w: number, h: number, label: string, action: () => void) {
    const ui = uiThemes.require('default'); const pressed = performance.now() < this.pressedUntil;
    this.roundRect(x, y + (pressed ? 3 : 0), w, h - (pressed ? 3 : 0), 14, pressed ? ui.colors.buttonPressed : ui.colors.button, '#fff0bd', 2);
    this.centerText(label, x + w / 2, y + h / 2 + (pressed ? 2 : 0), 16, '#172039', 800);
    this.uiHits.push({ x, y, w, h, action: () => { this.pressedUntil = performance.now() + 110; this.sounds.play('sound.select', 80); action(); } });
  }

  private iconButton(x: number, y: number, kind: 'sound' | 'tilt', active: boolean, action: () => void) {
    const context = mainContext; const ui = uiThemes.require('default'); const size = 40;
    this.roundRect(x, y, size, size, 12, active ? ui.colors.button : 'rgba(19,41,67,.82)', active ? '#fff0bd' : ui.colors.panelBorder, 2);
    context.save(); context.translate(x + size / 2, y + size / 2); context.strokeStyle = active ? '#172039' : ui.colors.muted; context.fillStyle = context.strokeStyle; context.lineWidth = 2.5; context.lineCap = 'round'; context.lineJoin = 'round';
    if (kind === 'sound') {
      context.beginPath(); context.moveTo(-10, -4); context.lineTo(-5, -4); context.lineTo(2, -10); context.lineTo(2, 10); context.lineTo(-5, 4); context.lineTo(-10, 4); context.closePath(); context.fill();
      context.beginPath();
      if (active) { context.arc(3, 0, 8, -Math.PI / 3, Math.PI / 3); context.moveTo(7, -11); context.arc(3, 0, 13, -1, 1); }
      else { context.moveTo(7, -7); context.lineTo(14, 7); context.moveTo(14, -7); context.lineTo(7, 7); }
      context.stroke();
    } else {
      context.strokeRect(-7, -11, 14, 22); context.beginPath(); context.moveTo(-14, -5); context.lineTo(-18, 0); context.lineTo(-14, 5); context.moveTo(14, -5); context.lineTo(18, 0); context.lineTo(14, 5); context.stroke();
      if (!active) { context.strokeStyle = ui.colors.danger; context.beginPath(); context.moveTo(-13, 13); context.lineTo(13, -13); context.stroke(); }
    }
    context.restore();
    this.uiHits.push({ x, y, w: size, h: size, action });
  }

  private drawFlash(width: number) {
    if (!this.flash || performance.now() > this.flashUntil) return;
    this.roundRect(width / 2 - 150, this.viewport.y + 137, 300, 42, 13, 'rgba(10,14,35,.9)', '#8bd5e8', 1);
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

  private readSoundPreference() {
    try { return localStorage.getItem('skyward:sound') !== 'off'; }
    catch { return true; }
  }

  private toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    this.sounds.setEnabled(this.soundEnabled);
    try { localStorage.setItem('skyward:sound', this.soundEnabled ? 'on' : 'off'); } catch { /* Storage may be unavailable in embedded rooms. */ }
    if (this.soundEnabled) this.sounds.play('sound.select', 0);
  }

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
    this.bullets.push({ shotId: shot.shotId, projectileIndex: 0, x: shot.x, y: shot.y + 40, vy: 1050, life: 1.5, cosmetic: true, color, variant: projectileVariant(shot.power, 0) });
    if (shot.spread) {
      this.bullets.push(
        { shotId: shot.shotId, projectileIndex: 1, x: shot.x - 24, y: shot.y + 30, vy: 930, life: 1.5, cosmetic: true, color, variant: projectileVariant(shot.power, 1) },
        { shotId: shot.shotId, projectileIndex: 2, x: shot.x + 24, y: shot.y + 30, vy: 930, life: 1.5, cosmetic: true, color, variant: projectileVariant(shot.power, 2) },
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
  private playerIndex(id: string) { const index = this.state?.startedPlayers.indexOf(id) ?? -1; return index >= 0 ? index : 0; }
  private platformFor(id: string) {
    const chunkIndex = Number(id.split(':')[0]);
    const chunk = this.chunks.get(chunkIndex);
    return chunk?.platforms.find((platform) => platform.id === id) ?? null;
  }
  private isPlatformActive(platform: Platform) {
    const chunkIndex = Number(platform.id.split(':')[0]);
    if (platform.kind === 'relay-bridge') return this.state?.activeRelays.includes(`relay:${chunkIndex}`) ?? false;
    if (platform.kind === 'boss-exit') return isBossExitActive(platform, this.state?.nextGate ?? 1);
    return true;
  }
  private playerName(id: string) { return this.state?.players[id]?.name ?? '队友'; }
  private notify(message: string) { this.flash = message; this.flashUntil = performance.now() + 1600; }
  private drawIcon(id: string, x: number, y: number, size: number) { const image = assets.image(id); if (image) mainContext.drawImage(image, x, y, size, size); }
  private roundRect(x: number, y: number, w: number, h: number, radius: number, fill: string, stroke?: string, lineWidth = 1) {
    const context = mainContext; context.beginPath(); context.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2)); context.fillStyle = fill; context.fill();
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = lineWidth; context.stroke(); }
  }
  private panel(x: number, y: number, w: number, h: number, radius: number, opacity = 1) {
    const ui = uiThemes.require('default'); const fill = opacity >= 1 ? ui.colors.panel : ui.colors.panel.replace(/([0-9a-f]{2})$/i, Math.round(opacity * 255).toString(16).padStart(2, '0'));
    this.roundRect(x, y, w, h, radius, fill, ui.colors.panelBorder, 2);
  }
  private text(x: number, y: number, value: string, size: number, color: string, weight = 400) { const c = mainContext; c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(value, x, y); }
  private centerText(value: string, x: number, y: number, size: number, color: string, weight = 400) { const c = mainContext; c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, x, y); }
  private destroy = () => {
    for (const dispose of this.disposers.splice(0)) dispose();
    mainCanvas.removeEventListener('pointerdown', this.onPointerDown); mainCanvas.removeEventListener('pointerup', this.onPointerUp); mainCanvas.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey); window.removeEventListener('deviceorientation', this.onOrientation);
  };
}
