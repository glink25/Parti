import { mainCanvas, mainContext } from 'littlejsengine';
import { biomeForChunk, CONTENT_FINGERPRINT, enemyStrategies, PICKUP_PRESENTATION, platformStrategies } from '../content';
import { isBossDefeated } from '../game/boss';
import { BOSS_ARENA_FLOOR_OFFSET, BOSS_INTERVAL, BOSS_TRIGGER_OFFSET, CHUNK_HEIGHT, PLAYER_RADIUS, VIEW_HEIGHT, WORLD_WIDTH, type ActiveEffect, type BossAttack, type Chunk, type Enemy, type GameState, type Pickup, type PickupKind, type Platform, type PublicPlayer } from '../game/contracts';
import { contextFor, generateChunk, platformActive, platformPosition, runtimeContext } from '../game/generation';
import { BOSS_CAMERA_ANCHOR, damp, directDistance, flightSample, GRAVITY, JUMP_SPEED, MOVE_SPEED, NORMAL_CAMERA_ANCHOR, SUPER_JUMP_SPEED, wrapX } from '../runtime/physics';
import { acceptPose, advanceRemotePose, createRemotePose, type PosePacket, type RemotePose } from '../runtime/network';
import { createSkywardFlow, type SkywardFlow } from '../runtime/flow';
import { requestTiltPermission, TiltController } from '../runtime/tilt';
import { drawAttackArt, drawBackground, drawBulletArt, drawEnemyArt, drawPickupArt, drawPlatformArt, drawPlayerArt, drawVoidArt } from './art';

type Bullet = { id: string; x: number; y: number; vx?: number; vy: number; life: number; cosmetic: boolean; pierce?: boolean; power?: boolean; spread?: boolean; hits?: string[] };
type Viewport = { x: number; y: number; w: number; h: number; scale: number };
type Hit = { x: number; y: number; w: number; h: number; action(): void };
type VisualFx = { kind: 'hit' | 'jump' | 'dissipate'; x: number; y: number; startedAt: number; color?: string };

export class SkywardScene {
  private flow: SkywardFlow | null = null;
  private state: GameState | null = null;
  private local = { x: WORLD_WIDTH / 2, y: 120, vy: JUMP_SPEED, cameraBottom: 0, viewBottom: 0, alive: true };
  private chunks = new Map<number, Chunk>(); private bullets: Bullet[] = []; private remote: Record<string, RemotePose> = {};
  private direction = 0; private keyDirection: -1 | 0 | 1 = 0; private touches = new Map<number, -1 | 1>();
  private tilt = new TiltController();
  private previous = performance.now(); private telemetryAt = 0; private shotAt = 0; private hitAt = 0; private groundingUntil = 0; private epoch = -1; private pendingDeath = false; private shotSequence = 0; private poseSequence = 0; private hitSequence = 0; private outcomeSequence = 0;
  private locallyConsumedBuffs = new Set<PickupKind>(); private flying = false;
  private locallyBrokenPlatforms = new Map<string, number>(); private localFlightForcedAt: number | null = null; private warnedFlightBoundary = false;
  private optimisticallyDefeatedBosses = new Set<number>();
  private audio: AudioContext | null = null;
  private superJumpFxUntil = 0; private shieldBreakAt = 0;
  private visualFx: VisualFx[] = [];
  private cameraAnchor = NORMAL_CAMERA_ANCHOR;
  private pixelRatio = 1; private viewport: Viewport = { x: 0, y: 0, w: 0, h: 0, scale: 1 }; private hits: Hit[] = []; private flash = ''; private flashUntil = 0; private disposers: Array<() => void> = [];

  init() {
    this.flow = createSkywardFlow(parti, {
      state: (state) => this.receiveState(state), pose: (packet) => this.receivePose(packet),
      localShot: (shot) => { const me = this.me(); if (!me) return; const spread = this.buff(me, 'spread'), pierce = this.buff(me, 'pierce'), power = this.buff(me, 'power'), velocities = spread ? [-260, 0, 260] : [0]; this.bullets.push(...velocities.map((vx, index) => ({ id: `${shot.shotId}:${index}`, x: shot.x, y: shot.y + 35, vx, vy: 1050, life: 1.6, cosmetic: false, pierce, power, spread, hits: [] }))); },
      shot: (shot) => { if (shot.playerId !== parti.playerId) this.bullets.push({ id: shot.shotId, x: shot.x, y: shot.y + 30, vy: 1050, life: 1.6, cosmetic: true }); },
      pickup: (event) => { const info = PICKUP_PRESENTATION[event.kind as PickupKind]; this.playCue('pickup'); this.notify(`${this.playerName(event.playerId)} 获得${info.name}：${info.description}`); },
      death: (event) => this.notify(`${this.playerName(event.playerId)} 倒下了`),
      bossDefeated: (event) => { if (Number.isInteger(event.chunkIndex)) this.optimisticallyDefeatedBosses.add(event.chunkIndex); this.notify('Boss 已击败，上行通路恢复'); },
      outcome: (event) => { if (event.outcome === 'shield' && event.playerId !== parti.playerId) this.notify(`${this.playerName(event.playerId)} 的护盾抵消了伤害`); },
    });
    this.flow.game.addSystem({ update: (_, dt) => { const now = performance.now(); for (const p of Object.values(this.state?.players ?? {})) if (p.id !== parti.playerId) { const visual = this.remote[p.id] ??= createRemotePose(p.x, p.y); advanceRemotePose(visual, now, dt); } } });
    this.flow.game.addSystem({ update: (_, dt) => { const me = this.me(); if (!me?.alive || !this.local.alive || this.pendingDeath) return; this.simulate(dt); } });
    this.flow.game.addSystem({ update: (_, dt) => this.simulateBullets(dt) });
    this.flow.game.addSystem({ update: () => { if (this.me()?.alive && this.local.alive && !this.pendingDeath) this.interactions(performance.now()); } });
    if (parti.orientation) this.disposers.push(parti.orientation.onData((data) => this.orientation(data)));
    mainCanvas.addEventListener('pointerdown', this.pointerDown); mainCanvas.addEventListener('pointerup', this.pointerUp); mainCanvas.addEventListener('pointercancel', this.pointerUp);
    window.addEventListener('keydown', this.key); window.addEventListener('keyup', this.key); window.addEventListener('pagehide', this.destroy, { once: true }); parti.ready();
  }
  update() {
    const now = performance.now(), dt = Math.min(.04, Math.max(.001, (now - this.previous) / 1000)); this.previous = now; this.pixelRatio = mainCanvas.width / Math.max(1, mainCanvas.clientWidth); this.viewport = this.computeViewport();
    if (this.state?.phase !== 'running') return; const me = this.me(); if (!me) return;
    this.updateMovement(); this.flow?.game.update(dt);
    if (!me.alive || !this.local.alive || this.pendingDeath) return;
    if (now >= this.telemetryAt) { this.telemetryAt = now + 100; this.flow?.publishPose({ sequence: ++this.poseSequence, x: this.local.x, y: this.local.y, vy: this.local.vy, cameraBottom: this.local.cameraBottom, direction: this.direction }); }
  }
  private simulate(dt: number) {
    const me = this.me()!, previousY = this.local.y; this.local.x = wrapX(this.local.x + this.direction * MOVE_SPEED * dt);
    const rocket = this.effect(me, 'rocket'), propeller = this.effect(me, 'propeller'), slow = this.buff(me, 'slow-fall'), flight = rocket ?? propeller; if (!flight && this.flying) this.groundingUntil = Date.now() + 1200; this.flying = Boolean(flight);
    if (flight) { const kind = flight.id as 'rocket' | 'propeller'; const forcedAt = flight.forcedEndingAt ?? this.localFlightForcedAt ?? undefined; this.local.vy = flightSample(kind, Date.now() - flight.startedAt, forcedAt == null ? undefined : forcedAt - flight.startedAt).speed; } else { this.localFlightForcedAt = null; this.warnedFlightBoundary = false; const easing = Date.now() < this.groundingUntil; this.local.vy += ((slow && this.local.vy < 0) || easing ? GRAVITY * .42 : GRAVITY) * dt; }
    this.local.y += this.local.vy * dt;
    if (flight) { const boundary = ((this.state!.completedBossCount + 1) * BOSS_INTERVAL - 1) * CHUNK_HEIGHT + BOSS_TRIGGER_OFFSET; if (this.local.y >= boundary) { this.local.y = boundary; this.local.vy = 0; this.localFlightForcedAt ??= Date.now(); if (!this.warnedFlightBoundary) { this.warnedFlightBoundary = true; this.notify('Boss 空域：飞行器正在失效'); } } }
    if (!flight && this.local.vy <= 0) {
      const landing = this.platforms(Date.now()).find((p) => !this.locallyBrokenPlatforms.has(p.id) && this.platformCollidable(p.id) && previousY - PLAYER_RADIUS >= p.y && this.local.y - PLAYER_RADIUS <= p.y && directDistance(this.local.x, p.x) <= p.width / 2 + PLAYER_RADIUS * .42);
      if (landing) {
        const result = platformStrategies.require(landing.kind).contact(landing, this.runtime(Number(landing.id.split(':')[0])), this.state?.entities[landing.id]);
        this.flow?.landPlatform({ platformId: landing.id, sequence: ++this.outcomeSequence });
        if (result.damageReason) this.die(result.damageReason);
        else if (landing.kind === 'fragile') { this.locallyBrokenPlatforms.set(landing.id, Date.now()); this.playCue('break'); this.notify('脆弱平台碎裂了！'); }
        else { const superJump = this.buff(me, 'super-jump'); this.groundingUntil = 0; this.local.y = landing.y + PLAYER_RADIUS; this.local.vy = superJump ? Math.max(SUPER_JUMP_SPEED, result.bounceVelocity ?? JUMP_SPEED) : result.bounceVelocity ?? JUMP_SPEED; if (superJump) { this.superJumpFxUntil = performance.now() + 420; this.visualFx.push({ kind: 'jump', x: this.local.x, y: this.local.y, startedAt: performance.now(), color: '#f6ef76' }); } }
      }
    }
    const boss = this.activeBoss(); this.cameraAnchor = damp(this.cameraAnchor, boss ? BOSS_CAMERA_ANCHOR : NORMAL_CAMERA_ANCHOR, 6, dt);
    this.local.cameraBottom = Math.max(this.local.cameraBottom, this.local.y - VIEW_HEIGHT * NORMAL_CAMERA_ANCHOR);
    if (boss) {
      const arenaFloor = boss.chunkIndex * CHUNK_HEIGHT + BOSS_ARENA_FLOOR_OFFSET;
      this.local.cameraBottom = arenaFloor;
      const targetViewBottom = arenaFloor;
      this.local.viewBottom = damp(this.local.viewBottom, targetViewBottom, 8, dt);
    } else {
      const lowerAnchor = Math.max(.18, this.cameraAnchor - .2), upperTarget = this.local.y - VIEW_HEIGHT * this.cameraAnchor, lowerLine = this.local.viewBottom + VIEW_HEIGHT * lowerAnchor;
      let targetViewBottom = Math.max(this.local.viewBottom, upperTarget);
      if (this.local.y < lowerLine) targetViewBottom = this.local.y - VIEW_HEIGHT * lowerAnchor;
      targetViewBottom = Math.max(this.state?.teamVoidY ?? 0, targetViewBottom);
      this.local.viewBottom = damp(this.local.viewBottom, targetViewBottom, 12, dt);
    }
    if (this.local.y < (this.state?.teamVoidY ?? 0) - 60) this.die('虚空');
  }
  private simulateBullets(dt: number) { for (const b of this.bullets) { b.x = wrapX(b.x + (b.vx ?? 0) * dt); b.y += b.vy * dt; b.life -= dt; } this.bullets = this.bullets.filter((b) => b.life > 0); for (const b of this.bullets) { if (b.cosmetic) continue; const enemy = this.enemies().find((e) => !(b.hits ?? []).includes(e.id) && directDistance(b.x, e.x) < e.radius + 12 && Math.abs(b.y - e.y) < e.radius + 18); if (enemy) { (b.hits ??= []).push(enemy.id); if (!b.pierce) b.life = 0; this.visualFx.push({ kind: 'hit', x: b.x, y: b.y, startedAt: performance.now(), color: b.power ? '#ff8b62' : '#fff2a8' }); const sequence = ++this.hitSequence; this.flow?.hitEnemy({ eventId: `${parti.playerId}:hit:${sequence}`, sequence, shotId: b.id, enemyId: enemy.id, damage: this.buff(this.me()!, 'power') ? 2 : 1 }); } } }
  private interactions(now: number) {
    for (const e of this.enemies()) if (directDistance(this.local.x, e.x) < e.radius + PLAYER_RADIUS * .7 && Math.abs(this.local.y - e.y) < e.radius + PLAYER_RADIUS) {
      if (!e.boss && this.local.vy < -80 && this.local.y > e.y + 15) { this.local.vy = JUMP_SPEED; const sequence = ++this.hitSequence; this.flow?.stompEnemy({ eventId: `${parti.playerId}:hit:${sequence}`, sequence, enemyId: e.id }); }
      else if (now >= this.hitAt) { this.hitAt = now + 1200; this.die(e.boss ? 'Boss 接触' : '怪物'); }
    }
    for (const e of this.enemies().filter((enemy) => !enemy.boss)) for (const attack of e.attacks) { const elapsed = Date.now() - (this.state?.startedAt ?? Date.now()), cycle = elapsed % attack.cooldownMs, active = cycle >= attack.warningMs && cycle <= attack.warningMs + attack.activeMs; if (active && Math.abs(this.local.y - e.y) < (attack.radius ?? 36) && directDistance(this.local.x, e.x) < (attack.kind === 'shot' ? 260 : attack.radius ?? 70)) { this.die(`怪物 ${attack.kind}`); break; } }
    for (const p of this.pickups()) if (directDistance(this.local.x, p.x) < 55 && Math.abs(this.local.y - p.y) < 70) this.flow?.claimPickup({ pickupId: p.id, sequence: ++this.outcomeSequence });
    for (const attack of this.activeBoss()?.attacks ?? []) if (Date.now() >= attack.activeAt && Date.now() <= attack.endsAt && this.attackHits(attack)) { this.die(`Boss ${attack.kind}`); break; }
  }
  private attackHits(a: BossAttack) { if (a.kind === 'summon' || a.kind === 'platform-toggle') return false; if (a.kind === 'laser') return a.direction === 'left' || a.direction === 'right' ? Math.abs(this.local.y - a.y) < 45 : directDistance(this.local.x, a.x) < 45; return directDistance(this.local.x, a.x) < a.radius && Math.abs(this.local.y - a.y) < a.radius; }
  private receiveState(state: GameState) { const prior = this.state?.phase, previousEffects = parti.playerId ? this.state?.players[parti.playerId]?.effects : undefined; this.state = state; if (state.contentFingerprint !== CONTENT_FINGERPRINT) { this.notify('内容版本不一致，请刷新'); return; } const me = this.me(); if (!me) return; if (previousEffects) for (const id of Object.keys(previousEffects) as PickupKind[]) if (previousEffects[id] && !me.effects[id]) this.visualFx.push({ kind: 'dissipate', x: this.local.x, y: this.local.y, startedAt: performance.now(), color: id === 'power' ? '#ff8b62' : '#b9d7ff' }); for (const chunk of this.optimisticallyDefeatedBosses) if (isBossDefeated(state.completedBossCount, chunk)) this.optimisticallyDefeatedBosses.delete(chunk); this.hitSequence = Math.max(this.hitSequence, me.lastHitSequence ?? 0); this.outcomeSequence = Math.max(this.outcomeSequence, me.lastOutcomeSequence ?? 0); for (const kind of this.locallyConsumedBuffs) if (!me.effects[kind]) this.locallyConsumedBuffs.delete(kind); if (prior === 'lobby' && state.phase === 'running') { this.chunks.clear(); this.bullets = []; this.visualFx = []; this.remote = {}; this.cameraAnchor = NORMAL_CAMERA_ANCHOR; this.locallyBrokenPlatforms.clear(); this.optimisticallyDefeatedBosses.clear(); } if (state.phase === 'running' && me.positionEpoch !== this.epoch) { this.epoch = me.positionEpoch; this.pendingDeath = false; this.cameraAnchor = this.activeBoss() ? BOSS_CAMERA_ANCHOR : NORMAL_CAMERA_ANCHOR; this.local = { x: me.x, y: me.y, vy: me.vy || JUMP_SPEED, cameraBottom: me.cameraBottom, viewBottom: Math.max(state.teamVoidY, me.y - VIEW_HEIGHT * this.cameraAnchor), alive: true }; } if (!me.alive) { this.pendingDeath = false; this.local.alive = false; } else if (!this.pendingDeath) this.local.alive = true; }
  private receivePose(packet: PosePacket) { if (packet.playerId === parti.playerId) return; const player = this.state?.players[packet.playerId]; const pose = this.remote[packet.playerId] ??= createRemotePose(player?.x ?? packet.x, player?.y ?? packet.y); acceptPose(pose, packet, performance.now()); }
  private visibleChunks() { if (!this.state || this.state.phase !== 'running') return []; const start = Math.max(0, Math.floor(this.local.viewBottom / CHUNK_HEIGHT) - 1), end = Math.floor((this.local.viewBottom + VIEW_HEIGHT) / CHUNK_HEIGHT) + 1; const result = []; for (let i = start; i <= end; i += 1) { let c = this.chunks.get(i); if (!c) { c = generateChunk(this.state.seed, i, Math.max(1, this.state.startedPlayers.length)); this.chunks.set(i, c); } result.push(c); } return result; }
  private platforms(now = Date.now()) { return this.visibleChunks().flatMap((c) => c.platforms.map((p) => ({ chunk: c.index, platform: p }))).filter(({ chunk, platform }) => platformActive(platform, this.state?.entities ?? {}, this.runtime(chunk, now), this.bossDefeated(chunk)) && !this.platformDisabledByBoss(platform.id, now)).map(({ chunk, platform }) => ({ ...platform, ...platformPosition(platform, this.runtime(chunk, now)) })); }
  private enemies() { const boss = this.activeBoss(), generated = this.visibleChunks().flatMap((c) => c.enemies), summons = boss?.summons ?? []; return [...generated, ...summons].filter((e) => { const s = this.state?.entities[e.id]; return !(s?.kind === 'enemy' && s.defeated) && !(s?.kind === 'summon' && s.defeated) && !(e.boss && this.bossDefeated(Number(e.id.split(':')[0]))) && (!e.boss || this.state?.boss?.enemyId === e.id); }).map((e) => { const state = this.state?.entities[e.id], position = enemyStrategies.require(e.kind).position(e, this.runtime(Number(e.id.split(':')[0]))); return { ...e, ...position, hp: boss?.enemyId === e.id ? boss.hp : state?.kind === 'enemy' || state?.kind === 'summon' ? state.hp : e.hp }; }); }
  private pickups() { const generated = this.visibleChunks().flatMap((c) => c.pickups).filter((p) => { const state = this.state?.entities[p.id]; return state?.kind !== 'pickup' || !state.claimedBy; }), drops = Object.values(this.state?.entities ?? {}).flatMap((state) => state.kind === 'pickup' && state.pickup && !state.claimedBy ? [state.pickup] : []); return [...generated, ...drops]; }
  private bossDefeated(chunk: number) { return this.optimisticallyDefeatedBosses.has(chunk) || (this.state ? isBossDefeated(this.state.completedBossCount, chunk) : false); }
  private activeBoss() { const boss = this.state?.boss ?? null; return boss && !this.bossDefeated(boss.chunkIndex) ? boss : null; }
  private platformDisabledByBoss(id: string, now: number) { return Boolean(this.activeBoss()?.attacks.some((a) => a.platformId === id && a.kind === 'platform-toggle' && now >= a.activeAt && now <= a.endsAt)); }
  private buff(me: PublicPlayer, id: PickupKind) { const effect = me.effects[id]; return !this.locallyConsumedBuffs.has(id) && Boolean(effect && (effect.endsAt == null || effect.endsAt > Date.now())); }
  private effect(me: PublicPlayer, id: PickupKind): ActiveEffect | null { const effect = me.effects[id]; return !this.locallyConsumedBuffs.has(id) && effect && (effect.endsAt == null || effect.endsAt > Date.now()) ? effect : null; }
  private platformCollidable(id: string) { const state = this.state?.entities[id]; return state?.kind !== 'platform' || state.phase === 'active' || state.phase === 'warning'; }
  private shoot() { const me = this.me(); if (!me?.alive || !this.local.alive || performance.now() < this.shotAt) return; this.shotAt = performance.now() + (this.buff(me, 'rapid') ? 110 : 240); const id = `${parti.playerId}:${Date.now().toString(36)}:${++this.shotSequence}`; this.flow?.shoot({ shotId: id, x: this.local.x, y: this.local.y }); }
  private die(reason: string) {
    const me = this.me(); if (this.pendingDeath || !this.local.alive || (me?.invulnerableUntil ?? 0) > Date.now()) return;
    if (me && (this.effect(me, 'rocket') || this.effect(me, 'propeller'))) return;
    const sequence = ++this.outcomeSequence;
    if (me && this.buff(me, 'shield')) { this.locallyConsumedBuffs.add('shield'); this.shieldBreakAt = performance.now(); this.hitAt = performance.now() + 1200; this.notify('护盾抵消了伤害'); this.flow?.playerOutcome({ eventId: `${parti.playerId}:outcome:${sequence}`, sequence, outcome: 'shield', reason }); return; }
    this.pendingDeath = true; this.local.alive = false; this.flow?.playerOutcome({ eventId: `${parti.playerId}:outcome:${sequence}`, sequence, outcome: 'death', reason });
  }

  render() {
    const c = mainContext, width = mainCanvas.width / this.pixelRatio, height = mainCanvas.height / this.pixelRatio; c.save(); c.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0); c.clearRect(0, 0, width, height); c.fillStyle = '#070b14'; c.fillRect(0, 0, width, height); this.hits = [];
    c.save(); c.beginPath(); c.rect(this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h); c.clip(); if (this.state) this.drawWorld(); c.restore(); this.drawHud(width, height);
    if (!this.state) this.overlay(width, height, '连接房间中', ''); else if (this.state.phase === 'lobby') this.drawLobby(width, height); else if (this.state.phase === 'gameover') this.drawGameOver(width, height);
    if (performance.now() < this.flashUntil) { c.fillStyle = 'rgba(0,0,0,.75)'; c.fillRect(width / 2 - 180, 76, 360, 42); this.text(this.flash, width / 2, 97, 16, '#fff', 'center'); } c.restore();
  }
  private drawWorld() {
    const state = this.state; if (!state) return; const c = mainContext, centerChunk = Math.max(0, (this.local.viewBottom + VIEW_HEIGHT / 2) / CHUNK_HEIGHT), chunkIndex = Math.floor(centerChunk), biome = biomeForChunk(chunkIndex), nextBiome = biomeForChunk(Math.floor(chunkIndex / 10) * 10 + 10), biomeProgress = centerChunk % 10, backgroundMix = Math.max(0, Math.min(1, (biomeProgress - 8.25) / 1.75)); drawBackground(c, biome.id, nextBiome.id, backgroundMix, this.viewport.x, this.viewport.y, this.viewport.w, this.viewport.h, biome.background);
    for (const p of this.platforms()) this.drawPlatform(p, biome.platform); for (const p of this.pickups()) this.drawPickup(p); for (const e of this.enemies()) this.drawEnemy(e); for (const a of this.activeBoss()?.attacks ?? []) this.drawAttack(a);
    for (const p of Object.values(this.state?.players ?? {})) if (p.id !== parti.playerId && p.connected) { const v = this.remote[p.id] ?? p; this.drawPlayer(v.x, v.y, '#76a9ff', p.name, p.direction); }
    if (this.me()?.alive && this.local.alive) this.drawPlayer(this.local.x, this.local.y, '#fff176', 'YOU', this.direction); for (const b of this.bullets) drawBulletArt(c, this.toScreen(b.x, b.y), b.cosmetic, { power: b.power, pierce: b.pierce, spread: b.spread });
    this.drawVisualFx();
    if (state.teamVoidY > this.local.viewBottom - 60) { const y = this.toScreen(0, state.teamVoidY).y; drawVoidArt(c, this.viewport.x, y, this.viewport.w, this.viewport.y + this.viewport.h - y); }
  }
  private drawPlatform(p: Platform, fallback: string) { const s = this.toScreen(p.x, p.y), description = platformStrategies.require(p.kind).render(p, this.runtime(Number(p.id.split(':')[0])), this.state?.entities[p.id]), localBreak = this.locallyBrokenPlatforms.get(p.id); if (description.hidden) return; drawPlatformArt(mainContext, s, p.width * this.viewport.scale, 22 * this.viewport.scale, { kind: p.kind, color: description.color || fallback, warning: Boolean(description.warning), breaking: description.breaking || localBreak != null, changedAt: description.changedAt ?? localBreak, spikeRange: description.spikeRange }, this.viewport.scale); }
  private drawEnemy(e: Enemy) { drawEnemyArt(mainContext, e.kind, this.toScreen(e.x, e.y), e.radius * this.viewport.scale, e.hp); }
  private drawPickup(p: Pickup) { const s = this.toScreen(p.x, p.y); drawPickupArt(mainContext, p.kind, s, 25 * this.viewport.scale); const info = PICKUP_PRESENTATION[p.kind]; this.label(`${info.name} · ${info.description}`, s.x, s.y - 38 * this.viewport.scale); }
  private drawPlayer(x: number, y: number, color: string, name: string, direction: number) { const s = this.toScreen(x, y), r = PLAYER_RADIUS * this.viewport.scale; drawPlayerArt(mainContext, s, r, color, direction, name === 'YOU'); if (name === 'YOU') this.drawLocalEffects(s, r); this.label(name, s.x, s.y - r - 13); }
  private drawAttack(a: BossAttack) { drawAttackArt(mainContext, a, this.toScreen(a.x, a.y), (a.kind === 'lightning' ? 90 : 120) * this.viewport.scale, Date.now() < a.activeAt, this.viewport); }
  private drawHud(width: number, height: number) { if (!this.state) return; const me = this.me(), boss = this.activeBoss(); this.text(`高度 ${Math.max(0, Math.floor(this.local.y))}  Boss ${this.state.completedBossCount}`, 18, 22, 16, '#fff'); if (me) this.drawBuffCards(me); if (boss) { const ratio = boss.hp / boss.maxHp; mainContext.fillStyle = '#2a2335'; mainContext.fillRect(width / 2 - 150, 24, 300, 18); mainContext.fillStyle = '#ff5577'; mainContext.fillRect(width / 2 - 150, 24, 300 * ratio, 18); }
    const fireSize = 64, fireX = width - fireSize - 18, fireY = height - fireSize - 18; this.drawFireControl(fireX, fireY, fireSize);
    const tiltSize = 48; this.drawTiltControl(width - tiltSize - 18, Math.max(18, this.viewport.y + 12), tiltSize); }
  private drawBuffCards(me: PublicPlayer) { const now = Date.now(), effects = Object.values(me.effects).filter((e): e is ActiveEffect => Boolean(e && (e.endsAt == null || e.endsAt > now))); effects.forEach((effect, index) => { const info = PICKUP_PRESENTATION[effect.id], x = 18, y = 44 + index * 38, w = 190, h = 32, duration = effect.endsAt == null ? 0 : Math.max(1, effect.endsAt - effect.startedAt), remaining = effect.endsAt == null ? 1 : Math.max(0, (effect.endsAt - now) / duration), warning = effect.endsAt != null && remaining < .2 && Math.floor(now / 180) % 2 === 0; mainContext.fillStyle = warning ? 'rgba(255,113,105,.9)' : 'rgba(12,28,54,.88)'; mainContext.fillRect(x, y, w, h); mainContext.fillStyle = '#7eeeff'; mainContext.fillRect(x, y + h - 4, w * remaining, 4); let phase = effect.endsAt == null ? '1 次' : `${Math.ceil((effect.endsAt - now) / 1000)}s`; if (effect.id === 'rocket' || effect.id === 'propeller') { const forced = effect.forcedEndingAt == null ? undefined : effect.forcedEndingAt - effect.startedAt; const sample = flightSample(effect.id, now - effect.startedAt, forced); phase = ({ accelerating: '加速', cruising: '匀速', decelerating: '减速', finished: '结束' } as const)[sample.phase]; } this.text(`${info.name} · ${phase}`, x + 8, y + 14, 12, '#fff'); }); }
  private drawLocalEffects(s: { x: number; y: number }, r: number) { const me = this.me(); if (!me) return; const c = mainContext, now = Date.now(), visualNow = performance.now(); c.save(); if (this.buff(me, 'shield')) { c.strokeStyle = '#7eeeff'; c.lineWidth = 3; c.globalAlpha = .65 + Math.sin(visualNow * .008) * .2; c.beginPath(); c.arc(s.x, s.y, r * 1.25, 0, Math.PI * 2); c.stroke(); } const shieldBreak = (visualNow - this.shieldBreakAt) / 500; if (shieldBreak >= 0 && shieldBreak < 1) { c.strokeStyle='#7eeeff'; c.globalAlpha=1-shieldBreak; c.lineWidth=3; for(let i=0;i<8;i++){const a=i/8*Math.PI*2;c.beginPath();c.moveTo(s.x+Math.cos(a)*r*1.2,s.y+Math.sin(a)*r*1.2);c.lineTo(s.x+Math.cos(a)*r*(1.2+shieldBreak),s.y+Math.sin(a)*r*(1.2+shieldBreak));c.stroke();} } const flight = this.effect(me, 'rocket') ?? this.effect(me, 'propeller'); if (flight) { const kind=flight.id as 'rocket'|'propeller', forced=flight.forcedEndingAt==null?undefined:flight.forcedEndingAt-flight.startedAt, sample=flightSample(kind,now-flight.startedAt,forced), intensity=Math.max(.15,sample.speed/(kind==='rocket'?860:620)); c.fillStyle = kind==='rocket' ? '#ff9b62' : '#75d8ff'; const length = (8+24*intensity+Math.sin(now*.02)*4) * this.viewport.scale; c.beginPath(); c.moveTo(s.x-r*.35,s.y+r*.65); c.lineTo(s.x,s.y+r*.65+length); c.lineTo(s.x+r*.35,s.y+r*.65); c.fill(); } if (this.buff(me, 'super-jump') && visualNow < this.superJumpFxUntil) { const p=1-(this.superJumpFxUntil-visualNow)/420;c.strokeStyle='#f6ef76';c.globalAlpha=1-p;c.lineWidth=4;c.beginPath();c.ellipse(s.x,s.y+r*.8,r*(.5+p*1.5),r*(.15+p*.35),0,0,Math.PI*2);c.stroke(); } if (this.buff(me, 'slow-fall') && this.local.vy < 0) { c.strokeStyle='#b6d4ff'; c.globalAlpha=.65; for(let i=-1;i<=1;i++){c.beginPath();c.moveTo(s.x+i*r*.55,s.y+r*.7);c.lineTo(s.x+i*r*.75,s.y+r*1.2);c.stroke();} } c.restore(); }
  private drawVisualFx() { const now=performance.now(), c=mainContext; this.visualFx=this.visualFx.filter((fx)=>now-fx.startedAt<650); for(const fx of this.visualFx){const p=(now-fx.startedAt)/650,s=this.toScreen(fx.x,fx.y);c.save();c.strokeStyle=fx.color??'#fff';c.fillStyle=fx.color??'#fff';c.globalAlpha=1-p;if(fx.kind==='hit'){c.lineWidth=3;for(let i=0;i<6;i++){const a=i/6*Math.PI*2;c.beginPath();c.moveTo(s.x+Math.cos(a)*6,s.y+Math.sin(a)*6);c.lineTo(s.x+Math.cos(a)*(12+p*24),s.y+Math.sin(a)*(12+p*24));c.stroke();}}else if(fx.kind==='dissipate'){for(let i=0;i<8;i++)c.fillRect(s.x+(i-3.5)*6,s.y-p*(20+i*3),3,3);}else{for(let i=0;i<4;i++){c.beginPath();c.arc(s.x,s.y+p*(18+i*10),4-i*.6,0,Math.PI*2);c.fill();}}c.restore();} }
  private playCue(kind: 'break' | 'pickup') { try { const audio = this.audio ??= new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime; oscillator.type = kind === 'break' ? 'square' : 'sine'; oscillator.frequency.setValueAtTime(kind === 'break' ? 180 : 520, now); oscillator.frequency.exponentialRampToValueAtTime(kind === 'break' ? 65 : 880, now + .16); gain.gain.setValueAtTime(.08, now); gain.gain.exponentialRampToValueAtTime(.001, now + .18); oscillator.connect(gain).connect(audio.destination); oscillator.start(now); oscillator.stop(now + .18); } catch { /* Audio can be blocked until the first user gesture. */ } }
  private drawFireControl(x: number, y: number, size: number) { const c = mainContext, cx = x + size / 2, cy = y + size / 2, rapid = Boolean(this.me() && this.buff(this.me()!, 'rapid')), pulse = rapid ? 1 + Math.sin(performance.now() * .018) * .08 : 1; c.fillStyle = rapid ? 'rgba(255,212,99,.34)' : 'rgba(255,255,255,.18)'; c.beginPath(); c.arc(cx, cy, size / 2 * pulse, 0, Math.PI * 2); c.fill(); c.save(); c.translate(cx, cy); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -17); c.lineTo(8, -5); c.lineTo(6, 9); c.lineTo(-6, 9); c.lineTo(-8, -5); c.closePath(); c.fill(); c.fillStyle = rapid ? '#ffe16a' : '#ffb35c'; c.beginPath(); c.moveTo(-4, 12); c.lineTo(0, rapid ? 25 : 21); c.lineTo(4, 12); c.closePath(); c.fill(); c.restore(); this.hits.push({ x, y, w: size, h: size, action: () => this.shoot() }); }
  private drawTiltControl(x: number, y: number, size: number) { const c = mainContext, cx = x + size / 2, cy = y + size / 2; c.fillStyle = this.tilt.enabled ? 'rgba(44,154,118,.9)' : 'rgba(255,255,255,.18)'; c.beginPath(); c.arc(cx, cy, size / 2, 0, Math.PI * 2); c.fill(); c.save(); c.translate(cx, cy); c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.strokeRect(-7, -12, 14, 24); c.beginPath(); c.moveTo(-12, -5); c.lineTo(-17, 0); c.lineTo(-12, 5); c.moveTo(12, -5); c.lineTo(17, 0); c.lineTo(12, 5); c.stroke(); if (!this.tilt.enabled) { c.strokeStyle = '#ff6b78'; c.lineWidth = 3; c.beginPath(); c.moveTo(-14, 14); c.lineTo(14, -14); c.stroke(); } c.restore(); this.hits.push({ x, y, w: size, h: size, action: () => void this.toggleTilt() }); }
  private drawLobby(w: number, h: number) { const me = this.me(); this.overlay(w, h, 'SKYWARD', '穿过云海 · 一路向上'); const x = w / 2 - 100, y = h / 2 + 70; mainContext.fillStyle = me?.ready ? '#486878' : '#2c9a76'; mainContext.fillRect(x, y, 200, 52); this.text(me?.ready ? '等待其他玩家' : '准备', w / 2, y + 26, 18, '#fff', 'center'); this.hits.push({ x, y, w: 200, h: 52, action: () => this.flow?.setReady(!me?.ready) }); }
  private drawGameOver(w: number, h: number) { this.overlay(w, h, '远征结束', `最高 ${Math.floor(this.state?.highestY ?? 0)}`); if (this.state?.hostId === parti.playerId) { const x = w / 2 - 100, y = h / 2 + 65; mainContext.fillStyle = '#2c9a76'; mainContext.fillRect(x, y, 200, 52); this.text('返回准备', w / 2, y + 26, 18, '#fff', 'center'); this.hits.push({ x, y, w: 200, h: 52, action: () => this.flow?.restart() }); } }
  private overlay(w: number, h: number, title: string, sub: string) { mainContext.fillStyle = 'rgba(4,8,16,.82)'; mainContext.fillRect(0, 0, w, h); this.text(title, w / 2, h / 2 - 42, 30, '#fff', 'center'); this.text(sub, w / 2, h / 2 + 4, 15, '#a9c7e8', 'center'); }
  private label(value: string, x: number, y: number) { this.text(value, x, y, Math.max(9, 11 * this.viewport.scale), '#fff', 'center'); }
  private text(value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') { const c = mainContext; c.font = `${size}px ui-monospace, monospace`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(value, x, y); }
  private computeViewport() { const w = mainCanvas.width / this.pixelRatio, h = mainCanvas.height / this.pixelRatio, scale = Math.min(w / WORLD_WIDTH, h / VIEW_HEIGHT); return { x: (w - WORLD_WIDTH * scale) / 2, y: (h - VIEW_HEIGHT * scale) / 2, w: WORLD_WIDTH * scale, h: VIEW_HEIGHT * scale, scale }; }
  private toScreen(x: number, y: number) { return { x: this.viewport.x + x * this.viewport.scale, y: this.viewport.y + this.viewport.h - (y - this.local.viewBottom) * this.viewport.scale }; }
  private runtime(chunkIndex: number, now = Date.now()) { const state = this.state!; return runtimeContext(contextFor(state.seed, chunkIndex, Math.max(1, state.startedPlayers.length)), state.startedAt ?? now, now); }
  private me() { return this.state && parti.playerId ? this.state.players[parti.playerId] ?? null : null; } private playerName(id: string) { return this.state?.players[id]?.name ?? '队友'; } private notify(value: string) { this.flash = value; this.flashUntil = performance.now() + 1600; }
  private pointerDown = (e: PointerEvent) => { const rect = mainCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top; const hit = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h); if (hit) { hit.action(); return; } mainCanvas.setPointerCapture(e.pointerId); this.touches.set(e.pointerId, x < this.viewport.x + this.viewport.w / 2 ? -1 : 1); };
  private pointerUp = (e: PointerEvent) => { this.touches.delete(e.pointerId); };
  private key = (e: KeyboardEvent) => { if (e.code === 'Space' && e.type === 'keydown' && !e.repeat) { this.shoot(); e.preventDefault(); return; } const down = e.type === 'keydown'; if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keyDirection = down ? -1 : this.keyDirection === -1 ? 0 : this.keyDirection; if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keyDirection = down ? 1 : this.keyDirection === 1 ? 0 : this.keyDirection; if (e.code === 'KeyT' && down && !e.repeat) void this.toggleTilt(); };
  private updateMovement() {
    const touch = [...this.touches.values()].at(-1) ?? 0, direct = this.keyDirection || touch;
    this.direction = this.tilt.update(direct);
  }
  private orientation(data: { beta: number | null; gamma: number | null; screenAngle: number }) {
    this.tilt.receive(data);
  }
  private async toggleTilt() {
    if (this.tilt.enabled) { this.tilt.disable(); this.flow?.enableTilt(false); return; }
    if (!parti.orientation) { this.notify('当前环境不支持重力感应'); return; }
    const status = await requestTiltPermission(parti.orientation);
    if (status !== 'active' && status !== 'no-data') { this.notify('无法启用重力感应'); return; }
    this.tilt.enable(); this.flow?.enableTilt(true);
  }
  private destroy = () => { this.flow?.game.dispose(); this.flow = null; void this.audio?.close(); this.audio = null; for (const d of this.disposers.splice(0)) d(); mainCanvas.removeEventListener('pointerdown', this.pointerDown); mainCanvas.removeEventListener('pointerup', this.pointerUp); mainCanvas.removeEventListener('pointercancel', this.pointerUp); window.removeEventListener('keydown', this.key); window.removeEventListener('keyup', this.key); };
}
