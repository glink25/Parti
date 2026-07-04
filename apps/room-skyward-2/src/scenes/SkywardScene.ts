import { mainCanvas, mainContext } from 'littlejsengine';
import { biomeForChunk, CONTENT_FINGERPRINT, enemyStrategies, pickupStrategies, platformStrategies } from '../content';
import { isBossDefeated } from '../game/boss';
import { CHUNK_HEIGHT, PLAYER_RADIUS, VIEW_HEIGHT, WORLD_WIDTH, type BossAttack, type Chunk, type Enemy, type GameState, type Pickup, type PickupKind, type Platform, type PublicPlayer } from '../game/contracts';
import { contextFor, generateChunk, platformActive, platformPosition, runtimeContext } from '../game/generation';
import { directDistance, GRAVITY, JUMP_SPEED, MOVE_SPEED, tiltDirection, wrapX } from '../runtime/physics';
import { acceptPose, advanceRemotePose, createRemotePose, type PosePacket, type RemotePose } from '../runtime/network';

type Bullet = { id: string; x: number; y: number; vx?: number; vy: number; life: number; cosmetic: boolean; pierce?: boolean; hits?: string[] };
type Viewport = { x: number; y: number; w: number; h: number; scale: number };
type Hit = { x: number; y: number; w: number; h: number; action(): void };

export class SkywardScene {
  private state: GameState | null = null;
  private local = { x: WORLD_WIDTH / 2, y: 120, vy: JUMP_SPEED, cameraBottom: 0, viewBottom: 0, alive: true };
  private chunks = new Map<number, Chunk>(); private bullets: Bullet[] = []; private remote: Record<string, RemotePose> = {};
  private direction = 0; private keyDirection: -1 | 0 | 1 = 0; private touches = new Map<number, -1 | 1>(); private tilt = 0; private tiltEnabled = false; private tiltNeutral: number | null = null;
  private previous = performance.now(); private telemetryAt = 0; private shotAt = 0; private hitAt = 0; private groundingUntil = 0; private epoch = -1; private pendingDeath = false; private shotSequence = 0; private poseSequence = 0; private hitSequence = 0; private outcomeSequence = 0;
  private locallyConsumedBuffs = new Set<PickupKind>(); private flying = false;
  private optimisticallyDefeatedBosses = new Set<number>();
  private pixelRatio = 1; private viewport: Viewport = { x: 0, y: 0, w: 0, h: 0, scale: 1 }; private hits: Hit[] = []; private flash = ''; private flashUntil = 0; private disposers: Array<() => void> = [];

  init() {
    this.disposers.push(
      parti.onState((state) => this.receiveState(state as GameState)),
      parti.onEvent('skyward2:shot', (raw) => { const shot = raw as { shotId: string; playerId: string; x: number; y: number }; if (shot.playerId !== parti.playerId) this.bullets.push({ id: shot.shotId, x: shot.x, y: shot.y + 30, vy: 1050, life: 1.6, cosmetic: true }); }),
      parti.onEvent('skyward2:pose', (raw) => this.receivePose(raw as PosePacket)),
      parti.onEvent('skyward2:pickup', (raw) => this.notify(`${this.playerName((raw as { playerId: string }).playerId)} 获得 ${(raw as { kind: string }).kind}`)),
      parti.onEvent('skyward2:death', (raw) => this.notify(`${this.playerName((raw as { playerId: string }).playerId)} 倒下了`)),
      parti.onEvent('skyward2:boss-defeated', (raw) => { const chunkIndex = Number((raw as { chunkIndex: number }).chunkIndex); if (Number.isInteger(chunkIndex)) this.optimisticallyDefeatedBosses.add(chunkIndex); this.notify('Boss 已击败，上行通路恢复'); }),
      parti.onEvent('skyward2:outcome', (raw) => { const event = raw as { playerId: string; outcome: string }; if (event.outcome === 'shield' && event.playerId !== parti.playerId) this.notify(`${this.playerName(event.playerId)} 的护盾抵消了伤害`); }),
    );
    if (parti.orientation) this.disposers.push(parti.orientation.onData((data) => this.orientation(data)));
    mainCanvas.addEventListener('pointerdown', this.pointerDown); mainCanvas.addEventListener('pointerup', this.pointerUp); mainCanvas.addEventListener('pointercancel', this.pointerUp);
    window.addEventListener('keydown', this.key); window.addEventListener('keyup', this.key); window.addEventListener('pagehide', this.destroy, { once: true }); parti.ready();
  }
  update() {
    const now = performance.now(), dt = Math.min(.04, Math.max(.001, (now - this.previous) / 1000)); this.previous = now; this.pixelRatio = mainCanvas.width / Math.max(1, mainCanvas.clientWidth); this.viewport = this.computeViewport();
    if (this.state?.phase !== 'running') return; const me = this.me(); if (!me) return;
    for (const p of Object.values(this.state.players)) if (p.id !== parti.playerId) { const visual = this.remote[p.id] ??= createRemotePose(p.x, p.y); advanceRemotePose(visual, now, dt); }
    if (!me.alive || !this.local.alive || this.pendingDeath) return;
    const touch = [...this.touches.values()].at(-1) ?? 0; this.direction = this.keyDirection || touch || (this.tiltEnabled ? this.tilt : 0); this.simulate(dt, now); this.simulateBullets(dt); this.interactions(now);
    if (now >= this.telemetryAt) { this.telemetryAt = now + 100; void parti.action('publishPose', { sequence: ++this.poseSequence, x: this.local.x, y: this.local.y, vy: this.local.vy, cameraBottom: this.local.cameraBottom, direction: this.direction }); }
  }
  private simulate(dt: number, now: number) {
    const me = this.me()!, previousY = this.local.y; this.local.x = wrapX(this.local.x + this.direction * MOVE_SPEED * dt);
    const rocket = this.buff(me, 'rocket'), propeller = this.buff(me, 'propeller'), slow = this.buff(me, 'slow-fall'); if (!rocket && !propeller && this.flying) this.groundingUntil = Date.now() + 1200; this.flying = rocket || propeller;
    if (rocket) { const age = Date.now() - me.effects.rocket!.startedAt; this.local.vy = Math.min(760, 280 + age * .18); } else if (propeller) { const age = Date.now() - me.effects.propeller!.startedAt; this.local.vy = Math.min(520, 220 + age * .12); } else { const easing = Date.now() < this.groundingUntil; this.local.vy += ((slow && this.local.vy < 0) || easing ? GRAVITY * .42 : GRAVITY) * dt; }
    this.local.y += this.local.vy * dt;
    if (!rocket && !propeller && this.local.vy <= 0) {
      const landing = this.platforms(now).find((p) => previousY - PLAYER_RADIUS >= p.y && this.local.y - PLAYER_RADIUS <= p.y && directDistance(this.local.x, p.x) <= p.width / 2 + PLAYER_RADIUS * .42);
      if (landing) {
        const result = platformStrategies.require(landing.kind).contact(landing, this.runtime(Number(landing.id.split(':')[0])), this.state?.entities[landing.id]);
        void parti.action('landPlatform', { platformId: landing.id, sequence: ++this.outcomeSequence });
        if (result.damageReason) this.die(result.damageReason);
        else { this.groundingUntil = 0; this.local.y = landing.y + PLAYER_RADIUS; this.local.vy = this.buff(me, 'super-jump') ? Math.max(1170, result.bounceVelocity ?? JUMP_SPEED) : result.bounceVelocity ?? JUMP_SPEED; }
      }
    }
    this.local.cameraBottom = Math.max(this.local.cameraBottom, this.local.y - VIEW_HEIGHT * .56); const upper = this.local.viewBottom + VIEW_HEIGHT * .56, lower = this.local.viewBottom + VIEW_HEIGHT * .27;
    if (this.local.y > upper) this.local.viewBottom = this.local.y - VIEW_HEIGHT * .56; else if (this.local.y < lower) this.local.viewBottom = this.local.y - VIEW_HEIGHT * .27;
    this.local.viewBottom = Math.max(this.state?.teamVoidY ?? 0, this.local.viewBottom); if (this.local.y < (this.state?.teamVoidY ?? 0) - 60) this.die('虚空');
  }
  private simulateBullets(dt: number) { for (const b of this.bullets) { b.x = wrapX(b.x + (b.vx ?? 0) * dt); b.y += b.vy * dt; b.life -= dt; } this.bullets = this.bullets.filter((b) => b.life > 0); for (const b of this.bullets) { if (b.cosmetic) continue; const enemy = this.enemies().find((e) => !(b.hits ?? []).includes(e.id) && directDistance(b.x, e.x) < e.radius + 12 && Math.abs(b.y - e.y) < e.radius + 18); if (enemy) { (b.hits ??= []).push(enemy.id); if (!b.pierce) b.life = 0; const sequence = ++this.hitSequence; void parti.action('hitEnemy', { eventId: `${parti.playerId}:hit:${sequence}`, sequence, shotId: b.id, enemyId: enemy.id, damage: this.buff(this.me()!, 'power') ? 2 : 1 }); } } }
  private interactions(now: number) {
    for (const e of this.enemies()) if (directDistance(this.local.x, e.x) < e.radius + PLAYER_RADIUS * .7 && Math.abs(this.local.y - e.y) < e.radius + PLAYER_RADIUS) {
      if (!e.boss && this.local.vy < -80 && this.local.y > e.y + 15) { this.local.vy = JUMP_SPEED; const sequence = ++this.hitSequence; void parti.action('stompEnemy', { eventId: `${parti.playerId}:hit:${sequence}`, sequence, enemyId: e.id }); }
      else if (now >= this.hitAt) { this.hitAt = now + 1200; this.die(e.boss ? 'Boss 接触' : '怪物'); }
    }
    for (const e of this.enemies().filter((enemy) => !enemy.boss)) for (const attack of e.attacks) { const elapsed = Date.now() - (this.state?.startedAt ?? Date.now()), cycle = elapsed % attack.cooldownMs, active = cycle >= attack.warningMs && cycle <= attack.warningMs + attack.activeMs; if (active && Math.abs(this.local.y - e.y) < (attack.radius ?? 36) && directDistance(this.local.x, e.x) < (attack.kind === 'shot' ? 260 : attack.radius ?? 70)) { this.die(`怪物 ${attack.kind}`); break; } }
    for (const p of this.pickups()) if (directDistance(this.local.x, p.x) < 55 && Math.abs(this.local.y - p.y) < 70) void parti.action('claimPickup', { pickupId: p.id, sequence: ++this.outcomeSequence });
    for (const attack of this.activeBoss()?.attacks ?? []) if (Date.now() >= attack.activeAt && Date.now() <= attack.endsAt && this.attackHits(attack)) { this.die(`Boss ${attack.kind}`); break; }
  }
  private attackHits(a: BossAttack) { if (a.kind === 'summon' || a.kind === 'platform-toggle') return false; if (a.kind === 'laser') return a.direction === 'left' || a.direction === 'right' ? Math.abs(this.local.y - a.y) < 45 : directDistance(this.local.x, a.x) < 45; return directDistance(this.local.x, a.x) < a.radius && Math.abs(this.local.y - a.y) < a.radius; }
  private receiveState(state: GameState) { const prior = this.state?.phase; this.state = state; if (state.contentFingerprint !== CONTENT_FINGERPRINT) { this.notify('内容版本不一致，请刷新'); return; } const me = this.me(); if (!me) return; for (const chunk of this.optimisticallyDefeatedBosses) if (isBossDefeated(state.completedBossCount, chunk)) this.optimisticallyDefeatedBosses.delete(chunk); this.hitSequence = Math.max(this.hitSequence, me.lastHitSequence ?? 0); this.outcomeSequence = Math.max(this.outcomeSequence, me.lastOutcomeSequence ?? 0); for (const kind of this.locallyConsumedBuffs) if (!me.effects[kind]) this.locallyConsumedBuffs.delete(kind); if (prior === 'lobby' && state.phase === 'running') { this.chunks.clear(); this.bullets = []; this.remote = {}; this.optimisticallyDefeatedBosses.clear(); } if (state.phase === 'running' && me.positionEpoch !== this.epoch) { this.epoch = me.positionEpoch; this.pendingDeath = false; this.local = { x: me.x, y: me.y, vy: me.vy || JUMP_SPEED, cameraBottom: me.cameraBottom, viewBottom: Math.max(state.teamVoidY, me.y - VIEW_HEIGHT * .35), alive: true }; } if (!me.alive) { this.pendingDeath = false; this.local.alive = false; } else if (!this.pendingDeath) this.local.alive = true; }
  private receivePose(packet: PosePacket) { if (packet.playerId === parti.playerId) return; const player = this.state?.players[packet.playerId]; const pose = this.remote[packet.playerId] ??= createRemotePose(player?.x ?? packet.x, player?.y ?? packet.y); acceptPose(pose, packet, performance.now()); }
  private visibleChunks() { if (!this.state || this.state.phase !== 'running') return []; const start = Math.max(0, Math.floor(this.local.viewBottom / CHUNK_HEIGHT) - 1), end = Math.floor((this.local.viewBottom + VIEW_HEIGHT) / CHUNK_HEIGHT) + 1; const result = []; for (let i = start; i <= end; i += 1) { let c = this.chunks.get(i); if (!c) { c = generateChunk(this.state.seed, i, Math.max(1, this.state.startedPlayers.length)); this.chunks.set(i, c); } result.push(c); } return result; }
  private platforms(now = Date.now()) { return this.visibleChunks().flatMap((c) => c.platforms.map((p) => ({ chunk: c.index, platform: p }))).filter(({ chunk, platform }) => platformActive(platform, this.state?.entities ?? {}, this.runtime(chunk, now), this.bossDefeated(chunk)) && !this.platformDisabledByBoss(platform.id, now)).map(({ chunk, platform }) => ({ ...platform, ...platformPosition(platform, this.runtime(chunk, now)) })); }
  private enemies() { const boss = this.activeBoss(), generated = this.visibleChunks().flatMap((c) => c.enemies), summons = boss?.summons ?? []; return [...generated, ...summons].filter((e) => { const s = this.state?.entities[e.id]; return !(s?.kind === 'enemy' && s.defeated) && !(s?.kind === 'summon' && s.defeated) && !(e.boss && this.bossDefeated(Number(e.id.split(':')[0]))); }).map((e) => { const state = this.state?.entities[e.id], position = enemyStrategies.require(e.kind).position(e, this.runtime(Number(e.id.split(':')[0]))); return { ...e, ...position, hp: boss?.enemyId === e.id ? boss.hp : state?.kind === 'enemy' || state?.kind === 'summon' ? state.hp : e.hp }; }); }
  private pickups() { const generated = this.visibleChunks().flatMap((c) => c.pickups).filter((p) => { const state = this.state?.entities[p.id]; return state?.kind !== 'pickup' || !state.claimedBy; }), drops = Object.values(this.state?.entities ?? {}).flatMap((state) => state.kind === 'pickup' && state.pickup && !state.claimedBy ? [state.pickup] : []); return [...generated, ...drops]; }
  private bossDefeated(chunk: number) { return this.optimisticallyDefeatedBosses.has(chunk) || (this.state ? isBossDefeated(this.state.completedBossCount, chunk) : false); }
  private activeBoss() { const boss = this.state?.boss ?? null; return boss && !this.bossDefeated(boss.chunkIndex) ? boss : null; }
  private platformDisabledByBoss(id: string, now: number) { return Boolean(this.activeBoss()?.attacks.some((a) => a.platformId === id && a.kind === 'platform-toggle' && now >= a.activeAt && now <= a.endsAt)); }
  private buff(me: PublicPlayer, id: PickupKind) { const effect = me.effects[id]; return !this.locallyConsumedBuffs.has(id) && Boolean(effect && (effect.endsAt == null || effect.endsAt > Date.now())); }
  private shoot() { const me = this.me(); if (!me?.alive || !this.local.alive || performance.now() < this.shotAt) return; this.shotAt = performance.now() + (this.buff(me, 'rapid') ? 110 : 240); const id = `${parti.playerId}:${Date.now().toString(36)}:${++this.shotSequence}`, spread = this.buff(me, 'spread'), pierce = this.buff(me, 'pierce'), velocities = spread ? [-260, 0, 260] : [0]; this.bullets.push(...velocities.map((vx, index) => ({ id: `${id}:${index}`, x: this.local.x, y: this.local.y + 35, vx, vy: 1050, life: 1.6, cosmetic: false, pierce, hits: [] }))); void parti.action('shoot', { shotId: id, x: this.local.x, y: this.local.y }); }
  private die(reason: string) {
    const me = this.me(); if (this.pendingDeath || !this.local.alive || (me?.invulnerableUntil ?? 0) > Date.now()) return;
    const sequence = ++this.outcomeSequence;
    if (me && this.buff(me, 'shield')) { this.locallyConsumedBuffs.add('shield'); this.hitAt = performance.now() + 1200; this.notify('护盾抵消了伤害'); void parti.action('playerOutcome', { eventId: `${parti.playerId}:outcome:${sequence}`, sequence, outcome: 'shield', reason }); return; }
    this.pendingDeath = true; this.local.alive = false; void parti.action('playerOutcome', { eventId: `${parti.playerId}:outcome:${sequence}`, sequence, outcome: 'death', reason });
  }

  render() {
    const c = mainContext, width = mainCanvas.width / this.pixelRatio, height = mainCanvas.height / this.pixelRatio; c.save(); c.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0); c.clearRect(0, 0, width, height); c.fillStyle = '#070b14'; c.fillRect(0, 0, width, height); this.hits = [];
    c.save(); c.beginPath(); c.rect(this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h); c.clip(); this.drawWorld(); c.restore(); this.drawHud(width, height);
    if (!this.state) this.overlay(width, height, '连接房间中', ''); else if (this.state.phase === 'lobby') this.drawLobby(width, height); else if (this.state.phase === 'gameover') this.drawGameOver(width, height);
    if (performance.now() < this.flashUntil) { c.fillStyle = 'rgba(0,0,0,.75)'; c.fillRect(width / 2 - 180, 76, 360, 42); this.text(this.flash, width / 2, 97, 16, '#fff', 'center'); } c.restore();
  }
  private drawWorld() {
    const c = mainContext, biome = biomeForChunk(Math.max(0, Math.floor(this.local.viewBottom / CHUNK_HEIGHT))); c.fillStyle = biome.background; c.fillRect(this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h);
    for (const p of this.platforms()) this.drawPlatform(p, biome.platform); for (const p of this.pickups()) this.drawPickup(p); for (const e of this.enemies()) this.drawEnemy(e); for (const a of this.activeBoss()?.attacks ?? []) this.drawAttack(a);
    for (const p of Object.values(this.state?.players ?? {})) if (p.id !== parti.playerId && p.connected) { const v = this.remote[p.id] ?? p; this.drawPlayer(v.x, v.y, '#76a9ff', p.name); }
    if (this.me()?.alive && this.local.alive) this.drawPlayer(this.local.x, this.local.y, '#fff176', 'YOU'); for (const b of this.bullets) { const s = this.toScreen(b.x, b.y); c.fillStyle = b.cosmetic ? '#7db6ff' : '#fff'; c.fillRect(s.x - 4, s.y - 12, 8, 24); }
    if ((this.state?.teamVoidY ?? 0) > this.local.viewBottom - 60) { const y = this.toScreen(0, this.state!.teamVoidY).y; c.fillStyle = 'rgba(220,40,80,.25)'; c.fillRect(this.viewport.x, y, this.viewport.w, this.viewport.y + this.viewport.h - y); }
  }
  private drawPlatform(p: Platform, fallback: string) { const c = mainContext, s = this.toScreen(p.x, p.y), w = p.width * this.viewport.scale, h = 20 * this.viewport.scale, description = platformStrategies.require(p.kind).render(p, this.runtime(Number(p.id.split(':')[0])), this.state?.entities[p.id]); if (description.hidden) return; c.fillStyle = description.warning ? '#fff36b' : description.color || fallback; c.fillRect(s.x - w / 2, s.y - h / 2, w, h); if (description.spikeRange) { c.fillStyle = '#fff'; const left = s.x - w / 2 + w * description.spikeRange[0], right = s.x - w / 2 + w * description.spikeRange[1]; for (let x = left; x < right; x += 18 * this.viewport.scale) { c.beginPath(); c.moveTo(x, s.y - h / 2); c.lineTo(x + 9 * this.viewport.scale, s.y - h / 2 - 18 * this.viewport.scale); c.lineTo(x + 18 * this.viewport.scale, s.y - h / 2); c.fill(); } } this.label(description.label, s.x, s.y + 13 * this.viewport.scale); }
  private drawEnemy(e: Enemy) { const c = mainContext, s = this.toScreen(e.x, e.y), r = e.radius * this.viewport.scale; c.strokeStyle = e.boss ? '#ff5d73' : e.kind === 'floater' ? '#66e2ff' : '#ff9c5a'; c.lineWidth = 4; c.strokeRect(s.x - r, s.y - r, r * 2, r * 2); this.label(`${e.kind} ${e.hp}`, s.x, s.y); }
  private drawPickup(p: Pickup) { const c = mainContext, s = this.toScreen(p.x, p.y), r = 24 * this.viewport.scale; c.fillStyle = '#ffe16a'; c.beginPath(); c.arc(s.x, s.y, r, 0, Math.PI * 2); c.fill(); this.label(p.kind, s.x, s.y); }
  private drawPlayer(x: number, y: number, color: string, name: string) { const c = mainContext, s = this.toScreen(x, y), r = PLAYER_RADIUS * this.viewport.scale; c.fillStyle = color; c.fillRect(s.x - r, s.y - r, r * 2, r * 2); this.label(name, s.x, s.y - r - 10); }
  private drawAttack(a: BossAttack) { const c = mainContext, s = this.toScreen(a.x, a.y), warning = Date.now() < a.activeAt, r = (a.kind === 'lightning' ? 90 : 120) * this.viewport.scale; c.strokeStyle = warning ? '#fff36b' : '#ff3d66'; c.lineWidth = warning ? 3 : 8; c.beginPath(); c.arc(s.x, s.y, r, 0, Math.PI * 2); c.stroke(); this.label(a.kind, s.x, s.y); }
  private drawHud(width: number, height: number) { if (!this.state) return; const me = this.me(), boss = this.activeBoss(); this.text(`高度 ${Math.max(0, Math.floor(this.local.y))}  Boss ${this.state.completedBossCount}`, 18, 22, 16, '#fff'); if (me) { const buffs = Object.values(me.effects).filter((effect) => effect && (effect.endsAt == null || effect.endsAt > Date.now())).map((effect) => pickupStrategies.require(effect!.id).hud(effect!, Date.now())).join(' · '); this.text(buffs || '无增益', 18, 46, 13, '#b9d7ff'); } if (boss) { const ratio = boss.hp / boss.maxHp; mainContext.fillStyle = '#2a2335'; mainContext.fillRect(width / 2 - 150, 24, 300, 18); mainContext.fillStyle = '#ff5577'; mainContext.fillRect(width / 2 - 150, 24, 300 * ratio, 18); }
    const size = 64, x = width - size - 18, y = height - size - 18; mainContext.fillStyle = 'rgba(255,255,255,.18)'; mainContext.fillRect(x, y, size, size); this.text('FIRE', x + size / 2, y + size / 2, 13, '#fff', 'center'); this.hits.push({ x, y, w: size, h: size, action: () => this.shoot() }); }
  private drawLobby(w: number, h: number) { const me = this.me(); this.overlay(w, h, 'SKYWARD 2', '完全随机碰撞盒原型'); const x = w / 2 - 100, y = h / 2 + 70; mainContext.fillStyle = me?.ready ? '#486878' : '#2c9a76'; mainContext.fillRect(x, y, 200, 52); this.text(me?.ready ? '等待其他玩家' : '准备', w / 2, y + 26, 18, '#fff', 'center'); this.hits.push({ x, y, w: 200, h: 52, action: () => void parti.action('setReady', { ready: !me?.ready }) }); }
  private drawGameOver(w: number, h: number) { this.overlay(w, h, '远征结束', `最高 ${Math.floor(this.state?.highestY ?? 0)}`); if (this.state?.hostId === parti.playerId) { const x = w / 2 - 100, y = h / 2 + 65; mainContext.fillStyle = '#2c9a76'; mainContext.fillRect(x, y, 200, 52); this.text('返回准备', w / 2, y + 26, 18, '#fff', 'center'); this.hits.push({ x, y, w: 200, h: 52, action: () => void parti.action('restart') }); } }
  private overlay(w: number, h: number, title: string, sub: string) { mainContext.fillStyle = 'rgba(4,8,16,.82)'; mainContext.fillRect(0, 0, w, h); this.text(title, w / 2, h / 2 - 42, 30, '#fff', 'center'); this.text(sub, w / 2, h / 2 + 4, 15, '#a9c7e8', 'center'); }
  private label(value: string, x: number, y: number) { this.text(value, x, y, Math.max(9, 11 * this.viewport.scale), '#fff', 'center'); }
  private text(value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') { const c = mainContext; c.font = `${size}px ui-monospace, monospace`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(value, x, y); }
  private computeViewport() { const w = mainCanvas.width / this.pixelRatio, h = mainCanvas.height / this.pixelRatio, scale = Math.min(w / WORLD_WIDTH, h / VIEW_HEIGHT); return { x: (w - WORLD_WIDTH * scale) / 2, y: (h - VIEW_HEIGHT * scale) / 2, w: WORLD_WIDTH * scale, h: VIEW_HEIGHT * scale, scale }; }
  private toScreen(x: number, y: number) { return { x: this.viewport.x + x * this.viewport.scale, y: this.viewport.y + this.viewport.h - (y - this.local.viewBottom) * this.viewport.scale }; }
  private runtime(chunkIndex: number, now = Date.now()) { const state = this.state!; return runtimeContext(contextFor(state.seed, chunkIndex, Math.max(1, state.startedPlayers.length)), state.startedAt ?? now, now); }
  private me() { return this.state && parti.playerId ? this.state.players[parti.playerId] ?? null : null; } private playerName(id: string) { return this.state?.players[id]?.name ?? '队友'; } private notify(value: string) { this.flash = value; this.flashUntil = performance.now() + 1600; }
  private pointerDown = (e: PointerEvent) => { const rect = mainCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top; const hit = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h); if (hit) { hit.action(); return; } mainCanvas.setPointerCapture(e.pointerId); this.touches.set(e.pointerId, x < this.viewport.x + this.viewport.w / 2 ? -1 : 1); };
  private pointerUp = (e: PointerEvent) => { this.touches.delete(e.pointerId); };
  private key = (e: KeyboardEvent) => { if (e.code === 'Space' && e.type === 'keydown' && !e.repeat) { this.shoot(); e.preventDefault(); return; } const down = e.type === 'keydown'; if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keyDirection = down ? -1 : this.keyDirection === -1 ? 0 : this.keyDirection; if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keyDirection = down ? 1 : this.keyDirection === 1 ? 0 : this.keyDirection; if (e.code === 'KeyT' && down && !e.repeat) { this.tiltEnabled = !this.tiltEnabled; this.tiltNeutral = null; void parti.action('enableTilt', { enabled: this.tiltEnabled }); } };
  private orientation(data: { beta: number | null; gamma: number | null; screenAngle: number }) { if (!this.tiltEnabled) return; const raw = data.screenAngle === 90 ? -(data.beta ?? 0) : data.screenAngle === 270 ? data.beta ?? 0 : data.gamma ?? 0; this.tiltNeutral ??= raw; this.tilt = tiltDirection(raw - this.tiltNeutral); }
  private destroy = () => { for (const d of this.disposers.splice(0)) d(); mainCanvas.removeEventListener('pointerdown', this.pointerDown); mainCanvas.removeEventListener('pointerup', this.pointerUp); mainCanvas.removeEventListener('pointercancel', this.pointerUp); window.removeEventListener('keydown', this.key); window.removeEventListener('keyup', this.key); };
}
