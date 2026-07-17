import './style.css';

declare const parti: {
  playerId: string | null;
  getState(): unknown;
  onState(handler: (state: GameState) => void): () => void;
  onEvent(event: string, handler: (payload: any) => void): () => void;
  action(action: string, payload?: unknown): Promise<{ ok: true }>;
  ready(): void;
  log(...args: unknown[]): void;
};

type Phase = 'lobby' | 'playing' | 'finished';
type PlayerStatus = 'waiting' | 'queued' | 'alive' | 'eliminated';
type EventKind = 'speed_up' | 'reverse' | 'heal_zone' | 'slow_zone' | 'wide_zone' | 'multishot_zone';
type GamePlayer = {
  id: string; name: string; isHost: boolean; connected: boolean; status: PlayerStatus; seat: number;
  health: number; score: number; nextTurnShots: number; nextTurnWidth: number;
  stats: { shots: number; safeHits: number; collisions: number; timeouts: number };
};
type Dart = { id: string; ownerId: string; boardAngle: number; widthFactor: number; score: number };
type GameState = {
  schema: 'dart-roulette@1'; phase: Phase; hostId: string | null; serverNow: number;
  players: Record<string, GamePlayer>; activeOrder: string[]; currentIndex: number;
  turn: null | { id: string; playerId: string; required: number; fired: number; dartWidth: number; startedAt: number; deadline: number };
  rotation: { anchorAngle: number; anchorAt: number; speedFactor: number; direction: 1 | -1 };
  darts: Dart[];
  event: null | { id: string; kind: EventKind; label: string; description: string; zoneAngle: number | null; zoneArc: number | null; triggeredAt: number; activated: boolean };
  shotsSinceEvent: number; nextEventAt: number;
  pendingShot: null | { id: string; playerId: string; worldAngle: number; boardAngle: number; widthFactor: number; firedAt: number; impactAt: number };
  winnerId: string | null; finishedAt: number | null; round: number;
};

const TAU = Math.PI * 2;
const BASE_ROTATION_MS = 8_000;
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

let state: GameState | null = null;
let clockOffset = 0;
let mountedPhase: Phase | null = null;
let muted = false;
let audioContext: AudioContext | null = null;
let lastFrame = performance.now();
const playerCards = new Map<string, HTMLElement>();
const effects: Array<{ kind: 'safe' | 'collision' | 'heal'; boardAngle: number; started: number; color: string }> = [];

function hostNow(): number {
  return Date.now() + clockOffset;
}

function normalize(angle: number): number {
  const value = angle % TAU;
  return value < 0 ? value + TAU : value;
}

function rotationAt(game: GameState, at: number): number {
  const elapsed = Math.max(0, at - game.rotation.anchorAt);
  return normalize(game.rotation.anchorAngle + (elapsed / BASE_ROTATION_MS) * TAU * game.rotation.speedFactor * game.rotation.direction);
}

function colorFor(playerId: string): string {
  const index = Math.max(0, state?.activeOrder.indexOf(playerId) ?? 0);
  return COLORS[index % COLORS.length];
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
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
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

muteButton.addEventListener('click', () => {
  muted = !muted;
  muteButton.textContent = muted ? '🔇' : '🔊';
  muteButton.setAttribute('aria-label', muted ? '取消静音' : '静音');
  if (muted && audioContext) void audioContext.suspend();
  else ensureAudio();
});

shootButton.addEventListener('click', () => {
  ensureAudio();
  if (!state || state.phase !== 'playing') return;
  shootButton.disabled = true;
  void parti.action('shoot');
});

function mountOverlay(phase: Phase) {
  mountedPhase = phase;
  if (phase === 'playing') {
    overlay.hidden = true;
    overlay.replaceChildren();
    return;
  }
  overlay.hidden = false;
  const card = document.createElement('div');
  card.className = 'overlay-card';
  if (phase === 'lobby') {
    card.innerHTML = `
      <h1>飞镖轮盘</h1>
      <p>贴近对手的飞镖赢得高分，碰到任何飞镖都会失去生命。留到最后，成为酒馆里的王牌镖客。</p>
      <div class="roster" data-role="roster"></div>
      <button class="host-action" data-action="start" type="button">开始对局</button>
      <p data-role="lobby-note">至少需要 2 名玩家</p>`;
    card.querySelector<HTMLButtonElement>('[data-action="start"]')!.addEventListener('click', () => {
      ensureAudio();
      void parti.action('start_game');
    });
  } else {
    card.innerHTML = `
      <h1 data-role="winner-title">本局结束</h1>
      <p data-role="winner-copy"></p>
      <div class="ranking" data-role="ranking"></div>
      <button class="host-action" data-action="lobby" type="button">返回候场</button>`;
    card.querySelector<HTMLButtonElement>('[data-action="lobby"]')!.addEventListener('click', () => void parti.action('return_to_lobby'));
  }
  overlay.replaceChildren(card);
}

function updateOverlay(game: GameState) {
  if (mountedPhase !== game.phase) mountOverlay(game.phase);
  if (game.phase === 'lobby') {
    const waiting = Object.values(game.players).filter((player) => player.connected && player.status === 'waiting');
    const roster = overlay.querySelector<HTMLElement>('[data-role="roster"]');
    if (roster) {
      roster.replaceChildren(...waiting.map((player) => {
        const chip = document.createElement('span');
        chip.className = 'roster-chip';
        chip.textContent = `${player.isHost ? '♛ ' : ''}${player.name}`;
        return chip;
      }));
    }
    const isHost = parti.playerId === game.hostId;
    const start = overlay.querySelector<HTMLButtonElement>('[data-action="start"]');
    if (start) {
      start.hidden = !isHost;
      start.disabled = waiting.length < 2;
    }
    const note = overlay.querySelector<HTMLElement>('[data-role="lobby-note"]');
    if (note) note.textContent = isHost ? (waiting.length < 2 ? `还需 ${2 - waiting.length} 名玩家` : `${waiting.length} 名玩家已候场`) : '等待房主开始对局';
  }
  if (game.phase === 'finished') {
    const winner = game.winnerId ? game.players[game.winnerId] : null;
    const title = overlay.querySelector<HTMLElement>('[data-role="winner-title"]');
    const copy = overlay.querySelector<HTMLElement>('[data-role="winner-copy"]');
    if (title) title.textContent = winner ? `${winner.name} 留到了最后` : '本局无人幸存';
    if (copy) copy.textContent = winner?.id === parti.playerId ? '你是今晚的王牌镖客！' : '最终排名按存活、分数与安全命中数排列。';
    const ranking = overlay.querySelector<HTMLElement>('[data-role="ranking"]');
    const ordered = game.activeOrder.map((id) => game.players[id]).filter(Boolean).sort((a, b) => {
      if (a.id === game.winnerId) return -1;
      if (b.id === game.winnerId) return 1;
      return b.score - a.score || b.stats.safeHits - a.stats.safeHits;
    });
    if (ranking) ranking.innerHTML = ordered.map((player, index) => `<div class="rank-row"><span>${index + 1}</span><strong>${escapeHtml(player.name)}</strong><span>${player.score} 分</span></div>`).join('');
    const lobby = overlay.querySelector<HTMLButtonElement>('[data-action="lobby"]');
    if (lobby) lobby.hidden = parti.playerId !== game.hostId;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function updateScoreboard(game: GameState) {
  const visible = Object.values(game.players).filter((player) => player.connected || game.activeOrder.includes(player.id));
  const ids = new Set(visible.map((player) => player.id));
  for (const [id, card] of playerCards) {
    if (!ids.has(id)) { card.remove(); playerCards.delete(id); }
  }
  visible.sort((a, b) => {
    const ai = game.activeOrder.indexOf(a.id);
    const bi = game.activeOrder.indexOf(b.id);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const player of visible) {
    let card = playerCards.get(player.id);
    if (!card) {
      card = document.createElement('article');
      card.className = 'player-card';
      card.dataset.playerId = player.id;
      card.innerHTML = '<span class="player-swatch"></span><div class="player-copy"><div class="player-name"></div><div class="player-meta"></div></div><div class="player-score"></div>';
      playerCards.set(player.id, card);
    }
    card.style.setProperty('--player-color', colorFor(player.id));
    card.classList.toggle('current', game.turn?.playerId === player.id);
    card.classList.toggle('eliminated', player.status === 'eliminated');
    card.classList.toggle('queued', player.status === 'queued' || player.status === 'waiting');
    card.querySelector<HTMLElement>('.player-name')!.textContent = `${player.isHost ? '♛ ' : ''}${player.name}${player.id === parti.playerId ? '（你）' : ''}`;
    const status = player.status === 'queued' ? '下局候场' : player.status === 'waiting' ? '等待开局' : player.status === 'eliminated' ? '已淘汰' : `${'♥'.repeat(player.health)}${'♡'.repeat(3 - player.health)}${player.connected ? '' : ' · 离线'}`;
    card.querySelector<HTMLElement>('.player-meta')!.textContent = status;
    card.querySelector<HTMLElement>('.player-score')!.textContent = game.phase === 'lobby' ? '—' : String(player.score);
    scoreboard.append(card);
  }
}

function updateControls(game: GameState) {
  const current = game.turn ? game.players[game.turn.playerId] : null;
  const myTurn = game.phase === 'playing' && game.turn?.playerId === parti.playerId && !game.pendingShot && current?.status === 'alive';
  shootButton.disabled = !myTurn;
  if (game.phase === 'lobby') {
    turnLabel.textContent = '等待房主开局';
    shotsLeft.textContent = '候场中';
  } else if (game.phase === 'finished') {
    turnLabel.textContent = '对局结束';
    shotsLeft.textContent = '查看最终排名';
  } else if (current) {
    turnLabel.textContent = myTurn ? '轮到你了！' : `${current.name} 正在瞄准`;
    const remaining = Math.max(0, game.turn!.required - game.turn!.fired);
    shotsLeft.textContent = game.pendingShot ? '飞镖飞行中…' : `本回合还需 ${remaining} 支`;
  }
  if (game.event) {
    eventPill.hidden = false;
    eventPill.textContent = `${game.event.label} · ${game.event.description}`;
  } else {
    eventPill.hidden = true;
  }
}

function drawBoard(cx: number, cy: number, radius: number, rotation: number) {
  context.save();
  context.translate(cx, cy);
  context.shadowColor = 'rgba(0,0,0,.65)';
  context.shadowBlur = radius * .1;
  context.beginPath(); context.arc(0, 0, radius * 1.08, 0, TAU); context.fillStyle = '#2a160e'; context.fill();
  context.shadowBlur = 0;
  context.rotate(rotation);

  const wood = context.createRadialGradient(-radius * .2, -radius * .22, radius * .08, 0, 0, radius);
  wood.addColorStop(0, '#a66b3c'); wood.addColorStop(.45, '#7b4528'); wood.addColorStop(1, '#3a2015');
  context.beginPath(); context.arc(0, 0, radius, 0, TAU); context.fillStyle = wood; context.fill();
  for (let ring = 1; ring <= 8; ring += 1) {
    context.beginPath(); context.arc(0, 0, radius * ring / 9, 0, TAU);
    context.strokeStyle = `rgba(35,15,8,${.08 + ring * .012})`; context.lineWidth = Math.max(1, radius * .008); context.stroke();
  }
  for (let tick = 0; tick < 36; tick += 1) {
    const angle = tick / 36 * TAU;
    context.beginPath();
    context.moveTo(Math.cos(angle) * radius * .84, Math.sin(angle) * radius * .84);
    context.lineTo(Math.cos(angle) * radius * .97, Math.sin(angle) * radius * .97);
    context.strokeStyle = tick % 3 === 0 ? 'rgba(244,207,134,.45)' : 'rgba(244,207,134,.16)';
    context.lineWidth = tick % 3 === 0 ? 2 : 1; context.stroke();
  }

  const zoneAngle = state?.event?.zoneAngle;
  if (typeof zoneAngle === 'number' && state?.event) {
    const event = state.event;
    const reward = event.kind === 'heal_zone' || event.kind === 'slow_zone';
    context.beginPath();
    context.arc(0, 0, radius * .98, zoneAngle - event.zoneArc! / 2, zoneAngle + event.zoneArc! / 2);
    context.arc(0, 0, radius * .72, zoneAngle + event.zoneArc! / 2, zoneAngle - event.zoneArc! / 2, true);
    context.closePath();
    context.fillStyle = reward ? 'rgba(80,190,120,.38)' : 'rgba(211,68,56,.38)';
    context.fill();
    context.strokeStyle = reward ? '#77e29b' : '#ff7a66'; context.lineWidth = 2; context.stroke();
    const iconRadius = radius * .84;
    context.save(); context.translate(Math.cos(zoneAngle) * iconRadius, Math.sin(zoneAngle) * iconRadius); context.rotate(-rotation);
    context.fillStyle = '#fff2d5'; context.font = `900 ${Math.max(11, radius * .09)}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(event.kind === 'heal_zone' ? '+♥' : event.kind === 'slow_zone' ? '↓' : event.kind === 'wide_zone' ? '↔' : '×3', 0, 0);
    context.restore();
  }

  context.beginPath(); context.arc(0, 0, radius * .17, 0, TAU); context.fillStyle = '#6c1f19'; context.fill();
  context.beginPath(); context.arc(0, 0, radius * .075, 0, TAU); context.fillStyle = '#d9a844'; context.fill();
  context.restore();
}

function drawDart(angle: number, radius: number, cx: number, cy: number, color: string, widthFactor: number, alpha = 1, distanceOffset = 0) {
  const inner = radius - radius * .06 + distanceOffset;
  const outer = radius + radius * .27 + distanceOffset;
  const x1 = cx + Math.cos(angle) * inner; const y1 = cy + Math.sin(angle) * inner;
  const x2 = cx + Math.cos(angle) * outer; const y2 = cy + Math.sin(angle) * outer;
  context.save(); context.globalAlpha = alpha;
  context.strokeStyle = '#ded2bd'; context.lineWidth = Math.max(2, radius * .014 * widthFactor); context.lineCap = 'round';
  context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  const wing = radius * .055 * widthFactor;
  context.translate(x2, y2); context.rotate(angle);
  context.fillStyle = color; context.beginPath(); context.moveTo(0, 0); context.lineTo(wing * 1.4, -wing); context.lineTo(wing * 1.4, wing); context.closePath(); context.fill();
  context.restore();
}

function drawPlayers(game: GameState, cx: number, cy: number, radius: number) {
  const orbit = radius * 1.43;
  for (const id of game.activeOrder) {
    const player = game.players[id];
    if (!player) continue;
    const angle = -Math.PI / 2 + player.seat / game.activeOrder.length * TAU;
    const x = cx + Math.cos(angle) * orbit; const y = cy + Math.sin(angle) * orbit;
    const color = colorFor(id);
    context.save();
    context.globalAlpha = player.status === 'eliminated' ? .35 : 1;
    if (game.turn?.playerId === id) { context.shadowColor = color; context.shadowBlur = 20; }
    context.beginPath(); context.arc(x, y, Math.max(12, radius * .09), 0, TAU); context.fillStyle = '#26150e'; context.fill(); context.lineWidth = 3; context.strokeStyle = color; context.stroke();
    context.shadowBlur = 0; context.fillStyle = '#fff1d7'; context.font = `800 ${Math.max(8, radius * .055)}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(player.name.slice(0, 2), x, y);
    context.fillStyle = color; context.font = `700 ${Math.max(8, radius * .046)}px system-ui`;
    context.fillText(id === parti.playerId ? '你的位置' : player.name.slice(0, 8), x, y + Math.max(20, radius * .14));
    context.restore();
  }
}

function drawEffects(game: GameState, cx: number, cy: number, radius: number, rotation: number, now: number) {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    const progress = (now - effect.started) / 650;
    if (progress >= 1) { effects.splice(index, 1); continue; }
    const angle = effect.boardAngle + rotation;
    const x = cx + Math.cos(angle) * radius; const y = cy + Math.sin(angle) * radius;
    context.save(); context.globalAlpha = 1 - progress; context.strokeStyle = effect.color; context.lineWidth = 3;
    context.beginPath(); context.arc(x, y, radius * (.04 + progress * .18), 0, TAU); context.stroke(); context.restore();
  }
}

function renderFrame(now: number) {
  const bounds = arena.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(bounds.width * dpr));
  const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;
  const radius = Math.max(48, Math.min(bounds.width, bounds.height) * (bounds.width < 560 ? .29 : .31));
  const game = state;
  const hostTime = hostNow();
  const rotation = game?.phase === 'playing' || game?.phase === 'finished' ? rotationAt(game, hostTime) : now / BASE_ROTATION_MS * TAU;
  drawBoard(cx, cy, radius, rotation);

  if (game) {
    for (const dart of game.darts) drawDart(dart.boardAngle + rotation, radius, cx, cy, colorFor(dart.ownerId), dart.widthFactor);
    drawPlayers(game, cx, cy, radius);
    if (game.pendingShot) {
      const duration = game.pendingShot.impactAt - game.pendingShot.firedAt;
      const progress = Math.max(0, Math.min(1, (hostTime - game.pendingShot.firedAt) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      drawDart(game.pendingShot.worldAngle, radius, cx, cy, colorFor(game.pendingShot.playerId), game.pendingShot.widthFactor, 1, radius * .43 * (1 - eased));
    }
    drawEffects(game, cx, cy, radius, rotation, now);
    if (game.phase === 'playing' && game.turn) {
      const remaining = Math.max(0, game.turn.deadline - hostTime);
      const seconds = Math.ceil(remaining / 1000);
      timerValue.textContent = String(seconds);
      timerRing.style.setProperty('--progress', `${Math.max(0, Math.min(1, remaining / 10_000)) * 360}deg`);
      timerRing.classList.toggle('danger', remaining <= 3_000);
    } else {
      timerValue.textContent = '--'; timerRing.style.setProperty('--progress', '0deg'); timerRing.classList.remove('danger');
    }
  }
  lastFrame = now;
  requestAnimationFrame(renderFrame);
}

parti.onState((next) => {
  if (!next || next.schema !== 'dart-roulette@1') return;
  state = next;
  clockOffset = next.serverNow - Date.now();
  updateOverlay(next);
  updateScoreboard(next);
  updateControls(next);
});

parti.onEvent('roulette:dart-fired', (payload) => {
  sound('shoot');
  if (payload.playerId === parti.playerId) liveRegion.textContent = '飞镖已发射';
});

parti.onEvent('roulette:dart-resolved', (payload) => {
  const color = payload.collision ? '#ff6a58' : payload.zoneEffect === 'heal' ? '#79e89d' : colorFor(payload.playerId);
  effects.push({ kind: payload.collision ? 'collision' : payload.zoneEffect === 'heal' ? 'heal' : 'safe', boardAngle: payload.boardAngle, started: performance.now(), color });
  sound(payload.collision ? 'collision' : 'stick');
  if (payload.playerId === parti.playerId) {
    if (payload.collision) { sound('hurt'); liveRegion.textContent = '撞到飞镖，失去一点生命'; }
    else liveRegion.textContent = `安全命中，获得 ${payload.score} 分`;
  }
});

parti.onEvent('roulette:timeout', (payload) => {
  sound('hurt');
  if (payload.playerId === parti.playerId) liveRegion.textContent = `回合超时，扣除 ${payload.damage} 点生命`;
});

parti.onEvent('roulette:turn', (payload) => {
  if (payload.playerId === parti.playerId) { sound('turn'); liveRegion.textContent = '轮到你发射飞镖'; }
});

parti.onEvent('roulette:event', (payload) => {
  sound('event'); liveRegion.textContent = `随机事件：${payload.label}`;
});

parti.onEvent('roulette:game-over', (payload) => {
  sound('win');
  liveRegion.textContent = payload.winnerId === parti.playerId ? '你赢得了本局飞镖轮盘' : '本局已经结束';
});

window.addEventListener('blur', () => { shootButton.blur(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) shootButton.blur(); });

parti.ready();
requestAnimationFrame(renderFrame);
