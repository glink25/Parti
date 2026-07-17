import './style.css';
import {
  REBASE_MS,
  SHOT_FLIGHT_MS,
  applyPredictedShot,
  lobbyReadiness,
  seatWorldAngle,
  simulateShot,
  type GamePlayer,
  type GameState,
  type Phase,
  type RouletteEvent,
  type ShotCommit,
  type SimulatedShot,
  type TurnSnapshot,
} from './shared';
import { BASE_ROTATION_MS, TAU, normalizeAngle, rotationAngleAt, type Rotation } from './worker/logic';

declare const parti: {
  playerId: string | null;
  getState(): unknown;
  onState(handler: (state: GameState) => void): () => void;
  onEvent(event: string, handler: (payload: any) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
};

type ReplicaPhase = 'aligning' | 'active' | 'observing' | 'flying' | 'done' | 'recovering';
type LocalReplica = {
  turn: TurnSnapshot;
  rotation: Rotation;
  darts: GameState['darts'];
  players: Record<string, GamePlayer>;
  event: RouletteEvent | null;
  phase: ReplicaPhase;
  rebaseStarted: number;
  rebaseFrom: number;
  rebaseTo: number;
  wallEpoch: number;
  logicalEpoch: number;
  windowStarted: number;
  pending: { shot: SimulatedShot; started: number; applied: boolean } | null;
};
type RemoteFlight = { commit: ShotCommit; started: number };

const COLORS = ['#ef6a5b', '#5eb8ff', '#f5c451', '#68cf83', '#bb8cff', '#ff8ec7', '#62d5d2', '#f2944b'];
const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const context = canvas.getContext('2d')!;
const arena = document.querySelector<HTMLElement>('#arena')!;
const scoreboard = document.querySelector<HTMLElement>('#scoreboard')!;
const overlay = document.querySelector<HTMLElement>('#phase-overlay')!;
const eventPill = document.querySelector<HTMLElement>('#event-pill')!;
const turnLabel = document.querySelector<HTMLElement>('#turn-label')!;
const timerRing = document.querySelector<HTMLElement>('#timer-ring')!;
const timerValue = document.querySelector<HTMLElement>('#timer-value')!;
const shotsLeft = document.querySelector<HTMLElement>('#shots-left')!;
const shootButton = document.querySelector<HTMLButtonElement>('#shoot-button')!;
const muteButton = document.querySelector<HTMLButtonElement>('#mute-button')!;
const liveRegion = document.querySelector<HTMLElement>('#live-region')!;
const globalFeedback = document.querySelector<HTMLElement>('#global-feedback')!;
const feedbackIcon = document.querySelector<HTMLElement>('#feedback-icon')!;
const feedbackTitle = document.querySelector<HTMLElement>('#feedback-title')!;
const feedbackDetail = document.querySelector<HTMLElement>('#feedback-detail')!;
const feedbackFlash = document.querySelector<HTMLElement>('#feedback-flash')!;

let state: GameState | null = null;
let replica: LocalReplica | null = null;
let mountedPhase: Phase | null = null;
let muted = false;
let audioContext: AudioContext | null = null;
let lastVisualRotation = 0;
const playerCards = new Map<string, HTMLElement>();
const remoteFlights: RemoteFlight[] = [];
const effects: Array<{ boardAngle: number; started: number; color: string }> = [];
type FeedbackKind = 'damage' | 'reward' | 'penalty' | 'event' | 'elimination' | 'victory';
type FeedbackCue = { kind: FeedbackKind; icon: string; title: string; detail: string; duration?: number };
const feedbackQueue: FeedbackCue[] = [];
let feedbackPlaying = false;

function clonePlayers(players: Record<string, GamePlayer>): Record<string, GamePlayer> {
  return Object.fromEntries(Object.entries(players).map(([id, player]) => [id, { ...player, stats: { ...player.stats } }]));
}

function shortestAngle(from: number, to: number): number {
  return ((to - from + Math.PI * 3) % TAU) - Math.PI;
}

function localElapsed(local: LocalReplica, now: number): number {
  return local.logicalEpoch + Math.max(0, now - local.wallEpoch);
}

function visualRotation(now: number): number {
  if (!replica) return state?.rotation.anchorAngle ?? (now / BASE_ROTATION_MS) * TAU;
  if (replica.phase === 'aligning' || replica.phase === 'recovering') {
    const progress = Math.min(1, Math.max(0, (now - replica.rebaseStarted) / REBASE_MS));
    const eased = progress * progress * (3 - 2 * progress);
    return normalizeAngle(replica.rebaseFrom + shortestAngle(replica.rebaseFrom, replica.rebaseTo) * eased);
  }
  return rotationAngleAt(replica.rotation, localElapsed(replica, now));
}

function viewOffset(game: GameState | null): number {
  if (!game || !parti.playerId || game.activeOrder.length === 0) return 0;
  const me = game.players[parti.playerId];
  if (!me || me.seat < 0) return 0;
  return Math.PI / 2 - seatWorldAngle(me.seat, game.activeOrder.length);
}

function displayState(): GameState | null {
  if (!state || !replica) return state;
  return { ...state, players: replica.players, darts: replica.darts, rotation: replica.rotation, event: replica.event, turn: replica.turn };
}

function ensureAudio(): AudioContext | null {
  if (muted) return null;
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

function tone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = .06, slide = 0) {
  const audio = ensureAudio();
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), audio.currentTime + duration);
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + duration);
}

function sound(name: 'shoot' | 'stick' | 'collision' | 'hurt' | 'turn' | 'event' | 'win') {
  if (name === 'shoot') tone(260, .12, 'triangle', .045, 360);
  if (name === 'stick') tone(115, .09, 'square', .035, -45);
  if (name === 'collision') { tone(180, .13, 'sawtooth', .05, -120); tone(510, .07, 'square', .025, -260); }
  if (name === 'hurt') tone(140, .28, 'sawtooth', .045, -80);
  if (name === 'turn') { tone(540, .08, 'sine', .045, 100); setTimeout(() => tone(720, .12, 'sine', .04), 85); }
  if (name === 'event') { tone(330, .12, 'triangle', .04, 180); setTimeout(() => tone(610, .18, 'triangle', .04), 120); }
  if (name === 'win') { tone(392, .16, 'sine', .05); setTimeout(() => tone(523, .18, 'sine', .05), 170); setTimeout(() => tone(659, .32, 'sine', .05), 350); }
}

function restartAnimation(element: HTMLElement, className: string) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  element.addEventListener('animationend', () => element.classList.remove(className), { once: true });
}

function playFeedbackAnimation(kind: FeedbackKind) {
  const flashKind = kind === 'damage' || kind === 'elimination' ? 'damage'
    : kind === 'reward' ? 'reward'
      : kind === 'penalty' ? 'penalty' : 'event';
  restartAnimation(feedbackFlash, `flash-${flashKind}`);
  if (kind === 'damage' || kind === 'elimination') restartAnimation(arena, 'shake-impact');
}

function playNextFeedback() {
  const cue = feedbackQueue.shift();
  if (!cue) { feedbackPlaying = false; return; }
  feedbackPlaying = true;
  const duration = cue.duration ?? 1_350;
  globalFeedback.hidden = false;
  globalFeedback.dataset.kind = cue.kind;
  globalFeedback.style.setProperty('--feedback-duration', `${duration}ms`);
  feedbackIcon.textContent = cue.icon;
  feedbackTitle.textContent = cue.title;
  feedbackDetail.textContent = cue.detail;
  globalFeedback.classList.remove('is-visible');
  void globalFeedback.offsetWidth;
  globalFeedback.classList.add('is-visible');
  playFeedbackAnimation(cue.kind);
  liveRegion.textContent = `${cue.title}，${cue.detail}`;
  window.setTimeout(() => {
    globalFeedback.classList.remove('is-visible');
    globalFeedback.hidden = true;
    playNextFeedback();
  }, duration + 320);
}

function enqueueFeedback(cue: FeedbackCue) {
  feedbackQueue.push(cue);
  if (!feedbackPlaying) playNextFeedback();
}

function playerLabel(playerId: string): string {
  const player = displayState()?.players[playerId] ?? state?.players[playerId];
  if (!player) return '一名玩家';
  return playerId === parti.playerId ? '你' : player.name;
}

muteButton.addEventListener('click', () => {
  muted = !muted;
  muteButton.textContent = muted ? '🔇' : '🔊';
  muteButton.setAttribute('aria-label', muted ? '取消静音' : '静音');
  if (muted && audioContext) void audioContext.suspend(); else ensureAudio();
});

function beginReplica(game: GameState, now: number, recovering = false) {
  if (!game.turn) { replica = null; return; }
  const target = rotationAngleAt(game.rotation, game.turn.logicalElapsed);
  const preserveRemoteFlights = game.turn.playerId !== parti.playerId;
  if (!preserveRemoteFlights) remoteFlights.length = 0;
  const deferredDarts = new Set(preserveRemoteFlights ? remoteFlights.map((flight) => flight.commit.shotId) : []);
  replica = {
    turn: { ...game.turn, acceptedShotIds: [...game.turn.acceptedShotIds] },
    rotation: { ...game.rotation },
    darts: game.darts.filter((dart) => !deferredDarts.has(dart.id)).map((dart) => ({ ...dart })),
    players: clonePlayers(game.players),
    event: game.event ? { ...game.event } : null,
    phase: recovering ? 'recovering' : 'aligning',
    rebaseStarted: now,
    rebaseFrom: lastVisualRotation,
    rebaseTo: target,
    wallEpoch: now + REBASE_MS,
    logicalEpoch: game.turn.logicalElapsed,
    windowStarted: now + REBASE_MS,
    pending: null,
  };
}

function activateReplica(now: number) {
  if (!replica || (replica.phase !== 'aligning' && replica.phase !== 'recovering')) return;
  replica.wallEpoch = now;
  replica.logicalEpoch = replica.turn.logicalElapsed;
  replica.windowStarted = now;
  const mine = replica.turn.playerId === parti.playerId;
  replica.phase = mine ? 'active' : 'observing';
  if (mine) {
    void parti.action('accept_turn', { turnId: replica.turn.id, revision: replica.turn.revision });
    sound('turn');
    liveRegion.textContent = '轮到你发射飞镖';
  }
}

function shootLocal() {
  if (!state || !replica || replica.phase !== 'active' || replica.turn.playerId !== parti.playerId) return;
  const now = performance.now();
  const elapsed = localElapsed(replica, now);
  if (elapsed >= replica.turn.durationMs) { timeoutLocal(now); return; }
  const player = replica.players[replica.turn.playerId];
  const windowElapsed = Math.max(0, elapsed - replica.turn.logicalElapsed);
  const shot = simulateShot({
    turn: replica.turn,
    rotation: replica.rotation,
    darts: replica.darts,
    event: replica.event,
    ownerId: player.id,
    worldAngle: seatWorldAngle(player.seat, state.activeOrder.length),
    windowElapsed,
  });
  replica.pending = { shot, started: now, applied: false };
  replica.phase = 'flying';
  shootButton.disabled = true;
  sound('shoot');
}

shootButton.addEventListener('click', () => { ensureAudio(); shootLocal(); });

function applyLocalShot(now: number) {
  if (!replica?.pending || replica.pending.applied) return;
  const impactWall = replica.pending.started + SHOT_FLIGHT_MS;
  const shot = replica.pending.shot;
  replica.pending.applied = true;
  applyPredictedShot(replica.players, replica.darts, shot);
  replica.rotation = { ...shot.rotationAfter };
  replica.turn.committed += 1;
  replica.turn.lastAcceptedSeq = shot.seq;
  replica.turn.acceptedShotIds.push(shot.shotId);
  replica.turn.logicalElapsed = shot.impactElapsed;
  const { dart: _dart, ...commit } = shot;
  void parti.action('commit_shot', commit);

  const player = replica.players[shot.playerId];
  effects.push({ boardAngle: shot.boardAngle, started: now, color: shot.outcome.collisionTargetId ? '#ff6a58' : shot.outcome.zoneEffect === 'heal' ? '#79e89d' : colorFor(shot.playerId) });
  sound(shot.outcome.collisionTargetId ? 'collision' : 'stick');
  if (shot.outcome.collisionTargetId) sound('hurt');
  liveRegion.textContent = shot.outcome.collisionTargetId ? '撞到飞镖，失去一点生命' : `安全命中，获得 ${shot.outcome.score} 分`;
  replica.pending = null;
  if (player.status !== 'alive' || replica.turn.committed >= replica.turn.required) {
    replica.phase = 'done';
  } else {
    replica.wallEpoch = impactWall;
    replica.logicalEpoch = shot.impactElapsed;
    replica.windowStarted = impactWall;
    replica.phase = 'active';
  }
  const shown = displayState();
  if (shown) { updateScoreboard(shown); updateControls(shown); }
}

function timeoutLocal(now: number) {
  if (!replica || replica.phase !== 'active' || replica.turn.playerId !== parti.playerId) return;
  const finalElapsed = Math.max(replica.turn.durationMs, replica.turn.logicalElapsed);
  const rotationEndAngle = rotationAngleAt(replica.rotation, finalElapsed);
  const player = replica.players[replica.turn.playerId];
  const damage = Math.max(0, replica.turn.required - replica.turn.committed);
  player.health = Math.max(0, player.health - damage);
  player.stats.timeouts += 1;
  if (player.health === 0) player.status = 'eliminated';
  replica.phase = 'done';
  replica.rotation = { ...replica.rotation, anchorAngle: rotationEndAngle, anchorElapsed: finalElapsed };
  void parti.action('commit_timeout', {
    turnId: replica.turn.id,
    revision: replica.turn.revision,
    seq: replica.turn.lastAcceptedSeq + 1,
    finalElapsed,
    rotationEndAngle,
  });
  sound('hurt');
  liveRegion.textContent = `回合超时，扣除 ${damage} 点生命`;
  const shown = displayState();
  if (shown) { updateScoreboard(shown); updateControls(shown); }
  void now;
}

function mountOverlay(phase: Phase) {
  mountedPhase = phase;
  if (phase === 'playing') { overlay.hidden = true; overlay.replaceChildren(); return; }
  overlay.hidden = false;
  const card = document.createElement('div');
  card.className = 'overlay-card';
  if (phase === 'lobby') {
    card.innerHTML = '<h1>飞镖轮盘</h1><p>贴近对手的飞镖赢得高分，碰到任何飞镖都会失去生命。留到最后，成为酒馆里的王牌镖客。</p><div class="roster" data-role="roster"></div><div class="lobby-actions"><button class="ready-action" data-action="ready" type="button" aria-pressed="false">准备</button><button class="host-action" data-action="start" type="button">开始对局</button></div><p data-role="lobby-note">至少需要 2 名玩家</p>';
    card.querySelector<HTMLButtonElement>('[data-action="ready"]')!.addEventListener('click', () => { ensureAudio(); void parti.action('toggle_ready'); });
    card.querySelector<HTMLButtonElement>('[data-action="start"]')!.addEventListener('click', () => { ensureAudio(); void parti.action('start_game'); });
  } else {
    card.innerHTML = '<h1 data-role="winner-title">本局结束</h1><p data-role="winner-copy"></p><div class="ranking" data-role="ranking"></div><button class="host-action" data-action="lobby" type="button">返回候场</button>';
    card.querySelector<HTMLButtonElement>('[data-action="lobby"]')!.addEventListener('click', () => void parti.action('return_to_lobby'));
  }
  overlay.replaceChildren(card);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function updateOverlay(game: GameState) {
  if (mountedPhase !== game.phase) mountOverlay(game.phase);
  if (game.phase === 'lobby') {
    const readiness = lobbyReadiness(game.players);
    const waiting = readiness.candidates;
    const roster = overlay.querySelector<HTMLElement>('[data-role="roster"]');
    if (roster) roster.replaceChildren(...waiting.map((player) => {
      const chip = document.createElement('span');
      chip.className = `roster-chip ${player.ready ? 'ready' : 'not-ready'}`;
      chip.textContent = `${player.ready ? '✓ ' : '○ '}${player.isHost ? '♛ ' : ''}${player.name}`;
      return chip;
    }));
    const me = parti.playerId ? game.players[parti.playerId] : null;
    const isHost = parti.playerId === game.hostId || me?.isHost === true;
    const ready = overlay.querySelector<HTMLButtonElement>('[data-action="ready"]');
    if (ready) {
      const canReady = Boolean(me?.connected && me.status === 'waiting');
      ready.hidden = !canReady;
      ready.disabled = !canReady;
      ready.textContent = me?.ready ? '取消准备' : '准备';
      ready.classList.toggle('is-ready', me?.ready === true);
      ready.setAttribute('aria-pressed', String(me?.ready === true));
    }
    const start = overlay.querySelector<HTMLButtonElement>('[data-action="start"]');
    if (start) { start.hidden = !isHost; start.disabled = !readiness.canStart; }
    const note = overlay.querySelector<HTMLElement>('[data-role="lobby-note"]');
    if (note) {
      if (waiting.length < 2) note.textContent = `还需 ${2 - waiting.length} 名玩家加入并准备`;
      else if (readiness.unready.length > 0) note.textContent = `还有 ${readiness.unready.length} 名玩家未准备`;
      else note.textContent = isHost ? '全员已准备，可以开始对局' : '全员已准备，等待房主开始';
    }
  }
  if (game.phase === 'finished') {
    const winner = game.winnerId ? game.players[game.winnerId] : null;
    overlay.querySelector<HTMLElement>('[data-role="winner-title"]')!.textContent = winner ? `${winner.name} 留到了最后` : '本局无人幸存';
    overlay.querySelector<HTMLElement>('[data-role="winner-copy"]')!.textContent = winner?.id === parti.playerId ? '你是今晚的王牌镖客！' : '最终排名按存活、分数与安全命中数排列。';
    const ordered = game.activeOrder.map((id) => game.players[id]).filter(Boolean).sort((a, b) => a.id === game.winnerId ? -1 : b.id === game.winnerId ? 1 : b.score - a.score || b.stats.safeHits - a.stats.safeHits);
    overlay.querySelector<HTMLElement>('[data-role="ranking"]')!.innerHTML = ordered.map((player, index) => `<div class="rank-row"><span>${index + 1}</span><strong>${escapeHtml(player.name)}</strong><span>${player.score} 分</span></div>`).join('');
    overlay.querySelector<HTMLButtonElement>('[data-action="lobby"]')!.hidden = parti.playerId !== game.hostId;
  }
}

function colorFor(playerId: string): string {
  return COLORS[Math.max(0, state?.activeOrder.indexOf(playerId) ?? 0) % COLORS.length];
}

function updateScoreboard(game: GameState) {
  const visible = Object.values(game.players).filter((player) => player.connected || game.activeOrder.includes(player.id));
  const ids = new Set(visible.map((player) => player.id));
  for (const [id, card] of playerCards) if (!ids.has(id)) { card.remove(); playerCards.delete(id); }
  visible.sort((a, b) => {
    const ai = game.activeOrder.indexOf(a.id); const bi = game.activeOrder.indexOf(b.id);
    return ai >= 0 && bi >= 0 ? ai - bi : ai >= 0 ? -1 : bi >= 0 ? 1 : a.name.localeCompare(b.name);
  });
  for (const player of visible) {
    let card = playerCards.get(player.id);
    if (!card) {
      card = document.createElement('article'); card.className = 'player-card'; card.dataset.playerId = player.id;
      card.innerHTML = '<span class="player-swatch"></span><div class="player-copy"><div class="player-name"></div><div class="player-meta"></div></div><div class="player-score"></div>';
      playerCards.set(player.id, card);
    }
    card.style.setProperty('--player-color', colorFor(player.id));
    card.classList.toggle('current', game.turn?.playerId === player.id);
    card.classList.toggle('eliminated', player.status === 'eliminated');
    card.classList.toggle('queued', player.status === 'queued' || player.status === 'waiting');
    card.querySelector<HTMLElement>('.player-name')!.textContent = `${player.isHost ? '♛ ' : ''}${player.name}${player.id === parti.playerId ? '（你）' : ''}`;
    card.querySelector<HTMLElement>('.player-meta')!.textContent = player.status === 'queued' ? '下局候场' : player.status === 'waiting' ? (player.ready ? '已准备' : '未准备') : player.status === 'eliminated' ? '已淘汰' : `${'♥'.repeat(player.health)}${'♡'.repeat(3 - player.health)}${player.connected ? '' : ' · 离线'}`;
    card.querySelector<HTMLElement>('.player-score')!.textContent = game.phase === 'lobby' ? '—' : String(player.score);
    scoreboard.append(card);
  }
}

function updateControls(game: GameState) {
  const current = game.turn ? game.players[game.turn.playerId] : null;
  const myTurn = game.phase === 'playing' && game.turn?.playerId === parti.playerId && replica?.phase === 'active' && current?.status === 'alive';
  shootButton.disabled = !myTurn;
  if (game.phase === 'lobby') { turnLabel.textContent = '等待房主开局'; shotsLeft.textContent = '候场中'; }
  else if (game.phase === 'finished') { turnLabel.textContent = '对局结束'; shotsLeft.textContent = '查看最终排名'; }
  else if (current && game.turn) {
    turnLabel.textContent = myTurn ? '轮到你了！' : replica?.phase === 'aligning' || replica?.phase === 'recovering' ? '正在同步标靶…' : `${current.name} 正在瞄准`;
    shotsLeft.textContent = replica?.phase === 'flying' ? '飞镖飞行中…' : `本回合还需 ${Math.max(0, game.turn.required - game.turn.committed)} 支`;
  }
  if (game.event) { eventPill.hidden = false; eventPill.textContent = `${game.event.label} · ${game.event.description}`; }
  else eventPill.hidden = true;
}

function drawBoard(cx: number, cy: number, radius: number, rotation: number, event: RouletteEvent | null) {
  context.save(); context.translate(cx, cy); context.shadowColor = 'rgba(0,0,0,.65)'; context.shadowBlur = radius * .1;
  context.beginPath(); context.arc(0, 0, radius * 1.08, 0, TAU); context.fillStyle = '#2a160e'; context.fill(); context.shadowBlur = 0; context.rotate(rotation);
  const wood = context.createRadialGradient(-radius * .2, -radius * .22, radius * .08, 0, 0, radius);
  wood.addColorStop(0, '#a66b3c'); wood.addColorStop(.45, '#7b4528'); wood.addColorStop(1, '#3a2015');
  context.beginPath(); context.arc(0, 0, radius, 0, TAU); context.fillStyle = wood; context.fill();
  for (let ring = 1; ring <= 8; ring += 1) { context.beginPath(); context.arc(0, 0, radius * ring / 9, 0, TAU); context.strokeStyle = `rgba(35,15,8,${.08 + ring * .012})`; context.lineWidth = Math.max(1, radius * .008); context.stroke(); }
  for (let tick = 0; tick < 36; tick += 1) { const angle = tick / 36 * TAU; context.beginPath(); context.moveTo(Math.cos(angle) * radius * .84, Math.sin(angle) * radius * .84); context.lineTo(Math.cos(angle) * radius * .97, Math.sin(angle) * radius * .97); context.strokeStyle = tick % 3 === 0 ? 'rgba(244,207,134,.45)' : 'rgba(244,207,134,.16)'; context.lineWidth = tick % 3 === 0 ? 2 : 1; context.stroke(); }
  if (event?.zoneAngle !== null && event?.zoneAngle !== undefined) {
    const angle = event.zoneAngle; const reward = event.kind === 'heal_zone' || event.kind === 'slow_zone';
    context.beginPath(); context.arc(0, 0, radius * .98, angle - event.zoneArc! / 2, angle + event.zoneArc! / 2); context.arc(0, 0, radius * .72, angle + event.zoneArc! / 2, angle - event.zoneArc! / 2, true); context.closePath();
    context.fillStyle = reward ? 'rgba(80,190,120,.38)' : 'rgba(211,68,56,.38)'; context.fill(); context.strokeStyle = reward ? '#77e29b' : '#ff7a66'; context.lineWidth = 2; context.stroke();
  }
  context.beginPath(); context.arc(0, 0, radius * .17, 0, TAU); context.fillStyle = '#6c1f19'; context.fill(); context.beginPath(); context.arc(0, 0, radius * .075, 0, TAU); context.fillStyle = '#d9a844'; context.fill(); context.restore();
}

function drawDart(angle: number, radius: number, cx: number, cy: number, color: string, widthFactor: number, alpha = 1, distanceOffset = 0) {
  const inner = radius - radius * .06 + distanceOffset; const outer = radius + radius * .27 + distanceOffset;
  const x1 = cx + Math.cos(angle) * inner; const y1 = cy + Math.sin(angle) * inner; const x2 = cx + Math.cos(angle) * outer; const y2 = cy + Math.sin(angle) * outer;
  context.save(); context.globalAlpha = alpha; context.strokeStyle = '#ded2bd'; context.lineWidth = Math.max(2, radius * .014 * widthFactor); context.lineCap = 'round'; context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  const wing = radius * .055 * widthFactor; context.translate(x2, y2); context.rotate(angle); context.fillStyle = color; context.beginPath(); context.moveTo(0, 0); context.lineTo(wing * 1.4, -wing); context.lineTo(wing * 1.4, wing); context.closePath(); context.fill(); context.restore();
}

function drawReadyDart(game: GameState, radius: number, cx: number, cy: number, offset: number, now: number) {
  if (!game.turn || !replica || replica.phase === 'flying' || replica.phase === 'done') return;
  const player = game.players[game.turn.playerId];
  if (!player || player.status !== 'alive') return;
  const angle = seatWorldAngle(player.seat, game.activeOrder.length) + offset;
  const pulse = .78 + Math.sin(now / 180) * .12;
  context.save();
  context.shadowColor = colorFor(player.id);
  context.shadowBlur = 14;
  drawDart(angle, radius, cx, cy, colorFor(player.id), game.turn.dartWidth, pulse, radius * .13);
  context.restore();
}

function drawPlayers(game: GameState, cx: number, cy: number, radius: number, offset: number) {
  const orbit = radius * 1.43;
  for (const id of game.activeOrder) {
    const player = game.players[id]; if (!player) continue;
    const angle = seatWorldAngle(player.seat, game.activeOrder.length) + offset; const x = cx + Math.cos(angle) * orbit; const y = cy + Math.sin(angle) * orbit; const color = colorFor(id);
    context.save(); context.globalAlpha = player.status === 'eliminated' ? .35 : 1; if (game.turn?.playerId === id) { context.shadowColor = color; context.shadowBlur = 20; }
    context.beginPath(); context.arc(x, y, Math.max(12, radius * .09), 0, TAU); context.fillStyle = '#26150e'; context.fill(); context.lineWidth = 3; context.strokeStyle = color; context.stroke(); context.shadowBlur = 0;
    context.fillStyle = '#fff1d7'; context.font = `800 ${Math.max(8, radius * .055)}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(player.name.slice(0, 2), x, y);
    context.fillStyle = color; context.font = `700 ${Math.max(8, radius * .046)}px system-ui`; context.fillText(id === parti.playerId ? '你的位置' : player.name.slice(0, 8), x, y + Math.max(20, radius * .14)); context.restore();
  }
}

function drawRemoteFlight(flight: RemoteFlight, progress: number, game: GameState, cx: number, cy: number, radius: number, rotation: number, offset: number) {
  const player = game.players[flight.commit.playerId]; if (!player) return;
  const startAngle = seatWorldAngle(player.seat, game.activeOrder.length) + offset;
  const endAngle = flight.commit.boardAngle + rotation + offset;
  const sx = cx + Math.cos(startAngle) * radius * 1.35; const sy = cy + Math.sin(startAngle) * radius * 1.35;
  const ex = cx + Math.cos(endAngle) * radius; const ey = cy + Math.sin(endAngle) * radius;
  const eased = 1 - Math.pow(1 - progress, 3); const x = sx + (ex - sx) * eased; const y = sy + (ey - sy) * eased; const angle = Math.atan2(ey - sy, ex - sx);
  context.save(); context.translate(x, y); context.rotate(angle); context.strokeStyle = '#ded2bd'; context.lineWidth = 3; context.beginPath(); context.moveTo(-radius * .12, 0); context.lineTo(radius * .08, 0); context.stroke(); context.fillStyle = colorFor(player.id); context.fillRect(-radius * .16, -4, radius * .06, 8); context.restore();
}

function completeRemoteFlight(index: number, now: number) {
  const flight = remoteFlights[index]; remoteFlights.splice(index, 1);
  if (!replica || flight.commit.playerId === parti.playerId) return;
  if (!flight.commit.outcome.collisionTargetId && !replica.darts.some((dart) => dart.id === flight.commit.shotId)) {
    replica.darts.push({ id: flight.commit.shotId, ownerId: flight.commit.playerId, boardAngle: flight.commit.boardAngle, widthFactor: flight.commit.widthFactor, score: flight.commit.outcome.score });
  }
  if (flight.commit.turnId === replica.turn.id) {
    replica.rotation = { ...flight.commit.rotationAfter };
    replica.turn.logicalElapsed = flight.commit.impactElapsed;
    replica.turn.committed += 1;
    replica.turn.lastAcceptedSeq = flight.commit.seq;
    replica.wallEpoch = now;
    replica.logicalEpoch = flight.commit.impactElapsed;
  }
  sound(flight.commit.outcome.collisionTargetId ? 'collision' : 'stick');
}

function drawEffects(cx: number, cy: number, radius: number, rotation: number, offset: number, now: number) {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index]; const progress = (now - effect.started) / 650; if (progress >= 1) { effects.splice(index, 1); continue; }
    const angle = effect.boardAngle + rotation + offset; const x = cx + Math.cos(angle) * radius; const y = cy + Math.sin(angle) * radius;
    context.save(); context.globalAlpha = 1 - progress; context.strokeStyle = effect.color; context.lineWidth = 3; context.beginPath(); context.arc(x, y, radius * (.04 + progress * .18), 0, TAU); context.stroke(); context.restore();
  }
}

function renderFrame(now: number) {
  if (replica && (replica.phase === 'aligning' || replica.phase === 'recovering') && now - replica.rebaseStarted >= REBASE_MS) activateReplica(now);
  if (replica?.phase === 'active' && replica.turn.playerId === parti.playerId && localElapsed(replica, now) >= replica.turn.durationMs) timeoutLocal(now);
  if (replica?.phase === 'flying' && replica.pending && now - replica.pending.started >= SHOT_FLIGHT_MS) applyLocalShot(now);

  const bounds = arena.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); const pixelWidth = Math.max(1, Math.round(bounds.width * dpr)); const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, bounds.width, bounds.height);
  const cx = bounds.width / 2; const cy = bounds.height / 2; const radius = Math.max(48, Math.min(bounds.width, bounds.height) * (bounds.width < 560 ? .29 : .31));
  const game = displayState(); const rotation = visualRotation(now); lastVisualRotation = rotation; const offset = viewOffset(game);
  drawBoard(cx, cy, radius, rotation + offset, game?.event ?? null);
  if (game) {
    for (const dart of replica?.darts ?? game.darts) drawDart(dart.boardAngle + rotation + offset, radius, cx, cy, colorFor(dart.ownerId), dart.widthFactor);
    drawPlayers(game, cx, cy, radius, offset);
    drawReadyDart(game, radius, cx, cy, offset, now);
    if (replica?.pending) {
      const progress = Math.max(0, Math.min(1, (now - replica.pending.started) / SHOT_FLIGHT_MS));
      const player = game.players[replica.pending.shot.playerId]; const angle = seatWorldAngle(player.seat, game.activeOrder.length) + offset; const eased = 1 - Math.pow(1 - progress, 3);
      drawDart(angle, radius, cx, cy, colorFor(player.id), replica.pending.shot.widthFactor, 1, radius * .43 * (1 - eased));
    }
    for (let index = remoteFlights.length - 1; index >= 0; index -= 1) {
      const progress = (now - remoteFlights[index].started) / SHOT_FLIGHT_MS;
      if (progress >= 1) completeRemoteFlight(index, now); else drawRemoteFlight(remoteFlights[index], Math.max(0, progress), game, cx, cy, radius, rotation, offset);
    }
    drawEffects(cx, cy, radius, rotation, offset, now);
    if (game.phase === 'playing' && game.turn && replica) {
      const remaining = replica.turn.playerId === parti.playerId ? Math.max(0, replica.turn.durationMs - localElapsed(replica, now)) : replica.turn.durationMs;
      timerValue.textContent = replica.phase === 'aligning' || replica.phase === 'recovering' ? '···' : String(Math.ceil(remaining / 1000));
      timerRing.style.setProperty('--progress', `${Math.max(0, Math.min(1, remaining / replica.turn.durationMs)) * 360}deg`); timerRing.classList.toggle('danger', remaining <= 3_000);
    } else { timerValue.textContent = '--'; timerRing.style.setProperty('--progress', '0deg'); timerRing.classList.remove('danger'); }
    updateControls(game);
  }
  requestAnimationFrame(renderFrame);
}

parti.onState((next) => {
  if (!next || next.schema !== 'dart-roulette@2') return;
  const previousTurnId = state?.turn?.id;
  state = next;
  if (next.phase === 'playing' && next.turn && next.turn.id !== previousTurnId) beginReplica(next, performance.now());
  else if (next.phase !== 'playing') { replica = null; remoteFlights.length = 0; }
  updateOverlay(next); const shown = displayState() ?? next; updateScoreboard(shown); updateControls(shown);
});

parti.onEvent('roulette:shot-committed', (commit: ShotCommit) => {
  if (commit.playerId === parti.playerId) return;
  if (state?.turn?.playerId === parti.playerId) return;
  if (replica) replica.darts = replica.darts.filter((dart) => dart.id !== commit.shotId);
  remoteFlights.push({ commit, started: performance.now() }); sound('shoot');
});

parti.onEvent('roulette:commit-rejected', (payload) => {
  liveRegion.textContent = `本地结果未被接受，正在重新同步：${payload.reason}`;
  const latest = parti.getState() as GameState | null;
  if (latest?.schema === 'dart-roulette@2' && latest.phase === 'playing' && latest.turn) { state = latest; beginReplica(latest, performance.now(), true); }
});

parti.onEvent('roulette:lobby-error', (payload) => {
  const messages: Record<string, [string, string]> = {
    NOT_IN_LOBBY: ['当前无法准备或开局', '对局状态已经发生变化'],
    NOT_WAITING: ['当前无法准备', '你不在本局候场名单中'],
    HOST_ONLY: ['只有房主可以开始对局', '请等待房主操作'],
    NEED_MORE_PLAYERS: ['人数不足', `还需 ${payload.missing ?? 1} 名玩家`],
    TOO_MANY_PLAYERS: ['人数超出限制', '本游戏最多支持 8 名玩家'],
    PLAYERS_NOT_READY: ['还有玩家未准备', `请等待剩余 ${payload.count ?? 1} 名玩家准备`],
  };
  const [title, detail] = messages[payload.reason] ?? ['操作未完成', '请根据当前大厅状态重试'];
  enqueueFeedback({ kind: 'penalty', icon: '!', title, detail, duration: 1_500 });
});

parti.onEvent('roulette:health-changed', (payload) => {
  const name = playerLabel(payload.playerId);
  if (payload.delta < 0) {
    if (payload.playerId !== parti.playerId) sound('hurt');
    const reason = payload.reason === 'collision' ? '飞镖发生碰撞' : payload.reason === 'connection-timeout' ? '连接响应超时' : '回合倒计时结束';
    enqueueFeedback({ kind: 'damage', icon: '−♥', title: `${name}失去 ${Math.abs(payload.delta)} 点生命`, detail: `${reason} · 剩余 ${payload.health} 点` });
  } else if (payload.delta > 0) {
    enqueueFeedback({ kind: 'reward', icon: '+♥', title: `${name}恢复 ${payload.delta} 点生命`, detail: `暖炉祝福生效 · 当前 ${payload.health} 点` });
  }
});

parti.onEvent('roulette:zone-triggered', (payload) => {
  const name = playerLabel(payload.playerId);
  const cues: Record<string, FeedbackCue> = {
    slow: { kind: 'reward', icon: '↓', title: `${name}让转盘减速`, detail: '转速降低至基础速度的 0.7 倍' },
    wide: { kind: 'penalty', icon: '↔', title: `${name}命中笨重镖区`, detail: '下一回合飞镖宽度变为 1.5 倍' },
    multishot: { kind: 'penalty', icon: '×3', title: `${name}收到三镖罚单`, detail: '下一回合必须在总时限内发射三支' },
  };
  const cue = cues[payload.effect];
  if (cue) enqueueFeedback(cue);
});

parti.onEvent('roulette:player-eliminated', (payload) => {
  enqueueFeedback({ kind: 'elimination', icon: '☠', title: `${playerLabel(payload.playerId)}被淘汰`, detail: '生命值已经耗尽', duration: 1_650 });
});

parti.onEvent('roulette:timeout', (payload) => {
  if (payload.playerId === parti.playerId && payload.watchdog) liveRegion.textContent = `连接超时，扣除 ${payload.damage} 点生命`;
});

parti.onEvent('roulette:event', (payload) => {
  sound('event');
  enqueueFeedback({ kind: 'event', icon: '✦', title: `随机事件 · ${payload.label}`, detail: payload.description, duration: 1_750 });
});

parti.onEvent('roulette:round-started', (payload) => {
  const seconds = Math.round(payload.durationMs / 1_000);
  enqueueFeedback({ kind: 'event', icon: String(payload.round), title: `第 ${payload.round} 轮开始`, detail: `本轮每位玩家共有 ${seconds} 秒`, duration: 1_500 });
});

parti.onEvent('roulette:game-over', (payload) => {
  sound('win');
  const winner = payload.winnerId ? playerLabel(payload.winnerId) : '无人';
  enqueueFeedback({ kind: 'victory', icon: '♛', title: payload.winnerId === parti.playerId ? '你赢得了飞镖轮盘！' : `${winner}赢得本局`, detail: '最后的幸存者已经诞生', duration: 2_000 });
});

window.addEventListener('blur', () => shootButton.blur());
document.addEventListener('visibilitychange', () => { if (document.hidden) shootButton.blur(); });
parti.ready();
requestAnimationFrame(renderFrame);
