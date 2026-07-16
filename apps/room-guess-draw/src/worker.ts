// The Worker is bundled to a single ESM file by vite.config.ts. Parti's runtime
// injects defineRoom and does not load relative modules at runtime.
// @ts-nocheck
import { defineRoom } from '@parti/worker-sdk';
import { canApplyStroke, MAX_POINTS_PER_STROKE } from './canvas-budget';
import { relayTaskKind } from './game-logic';
import { acceptStrokeUpdate, createStrokeUpdateLedger, resetStrokeUpdateLedger } from './stroke-update';
import { CATEGORY_DEFS, WORD_BANK } from './word-bank';

const ROUND_MS = 90_000;
const PICK_MS = 20_000;
const RESULT_MS = 5_000;
const MAX_MESSAGES = 60;
const RELAY_GUESS_MS = 25_000;

let secretWord = null;
let secretWordId = null;
let classicStrokeLedger = createStrokeUpdateLedger();
const lastChatAt = new Map();
const strokeRate = new Map();
let relayChains = [];
let relayAssignments = new Map();
let relayGuesses = new Map();
let relayCanvases = new Map();
let relayStrokeDrafts = new Map();
let relayStrokeLedgers = new Map();
let relayReservedWordIds = new Set();

function categoriesForState() {
  return CATEGORY_DEFS.map(({ id, name, icon, description }) => ({ id, name, icon, description }));
}

function createUsedWords() {
  return Object.fromEntries(CATEGORY_DEFS.map(({ id }) => [id, []]));
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function comparable(value) {
  return cleanText(value)
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s，。！？、；：“”‘’（）()《》〈〉【】\[\],.!?;:'"\-_]/g, '');
}

function isPoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
    && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}

function addMessage(ctx, message) {
  ctx.state.messages.push({
    id: `${ctx.now().toString(36)}-${Math.floor(ctx.random() * 1e8).toString(36)}`,
    at: ctx.now(),
    ...message,
  });
  if (ctx.state.messages.length > MAX_MESSAGES) {
    ctx.state.messages.splice(0, ctx.state.messages.length - MAX_MESSAGES);
  }
}

function connectedPlayers(state) {
  return Object.values(state.players).filter((player) => player.connected);
}

function clearGameTimers(ctx) {
  ['pick', 'hint-1', 'hint-2', 'hint-3', 'round', 'result'].forEach((name) => ctx.clearTimer(name));
}

function resetRoundRuntime() {
  secretWord = null;
  secretWordId = null;
  resetStrokeUpdateLedger(classicStrokeLedger);
}

function resetRelayRuntime() {
  relayChains = [];
  relayAssignments = new Map();
  relayGuesses = new Map();
  relayCanvases = new Map();
  relayStrokeDrafts = new Map();
  relayStrokeLedgers = new Map();
  relayReservedWordIds = new Set();
}

function shuffled(ctx, values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(ctx.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function startGame(ctx) {
  clearGameTimers(ctx);
  resetRoundRuntime();
  const players = connectedPlayers(ctx.state);
  ctx.state.phase = 'choosing';
  ctx.state.scores = Object.fromEntries(players.map((player) => [player.id, 0]));
  ctx.state.roundPoints = {};
  ctx.state.turnOrder = shuffled(ctx, players.map((player) => player.id));
  ctx.state.turnIndex = -1;
  ctx.state.roundNumber = 0;
  ctx.state.roundResult = null;
  ctx.state.messages = [];
  Object.values(ctx.state.players).forEach((player) => { player.ready = false; });
  addMessage(ctx, { type: 'system', text: '所有人准备完毕，游戏开始！' });
  advanceTurn(ctx);
}

function maybeStartGame(ctx) {
  if (ctx.state.phase !== 'lobby' && ctx.state.phase !== 'game-over' && ctx.state.phase !== 'relay-gallery') return;
  const players = connectedPlayers(ctx.state);
  if (players.length >= 2 && players.every((player) => player.ready)) {
    if (ctx.state.mode === 'relay') startRelayGame(ctx);
    else startGame(ctx);
  }
}

function finishGame(ctx) {
  clearGameTimers(ctx);
  resetRoundRuntime();
  ctx.state.phase = 'game-over';
  ctx.state.drawerId = null;
  ctx.state.categoryId = null;
  ctx.state.pickEndsAt = null;
  ctx.state.roundEndsAt = null;
  ctx.state.roundGuessers = [];
  ctx.state.guessedIds = [];
  ctx.state.strokes = [];
  ctx.state.activeStroke = null;
  ctx.state.canvasRevision += 1;
  Object.values(ctx.state.players).forEach((player) => { player.ready = false; });
  addMessage(ctx, { type: 'system', text: '本局结束，最终排名出炉！' });
}

function beginChoosing(ctx, drawerId) {
  resetRoundRuntime();
  ctx.state.phase = 'choosing';
  ctx.state.drawerId = drawerId;
  ctx.state.categoryId = null;
  ctx.state.revealedHints = [];
  ctx.state.roundEndsAt = null;
  ctx.state.pickEndsAt = ctx.now() + PICK_MS;
  ctx.state.roundGuessers = connectedPlayers(ctx.state)
    .map((player) => player.id)
    .filter((id) => id !== drawerId);
  ctx.state.guessedIds = [];
  ctx.state.roundPoints = {};
  ctx.state.roundResult = null;
  ctx.state.strokes = [];
  ctx.state.activeStroke = null;
  ctx.state.canvasRevision += 1;
  const drawer = ctx.state.players[drawerId];
  addMessage(ctx, { type: 'system', text: `轮到 ${drawer?.name || '下一位玩家'} 作画，请选择分类。` });
  ctx.setTimer('pick', PICK_MS, () => {
    if (ctx.state.phase !== 'choosing' || ctx.state.drawerId !== drawerId) return;
    const category = CATEGORY_DEFS[Math.floor(ctx.random() * CATEGORY_DEFS.length)];
    beginDrawing(ctx, category.id);
  });
}

function advanceTurn(ctx) {
  clearGameTimers(ctx);
  let nextIndex = ctx.state.turnIndex + 1;
  while (nextIndex < ctx.state.turnOrder.length) {
    const candidate = ctx.state.players[ctx.state.turnOrder[nextIndex]];
    if (candidate?.connected) break;
    nextIndex += 1;
  }
  if (nextIndex >= ctx.state.turnOrder.length) {
    finishGame(ctx);
    return;
  }
  ctx.state.turnIndex = nextIndex;
  ctx.state.roundNumber = nextIndex + 1;
  beginChoosing(ctx, ctx.state.turnOrder[nextIndex]);
}

function pickUnusedWord(ctx, categoryId) {
  const words = WORD_BANK[categoryId];
  if (!words) return null;
  const used = new Set(ctx.state.usedWordIds[categoryId] || []);
  let available = words.filter((entry) => !used.has(entry.id));
  if (available.length === 0) {
    ctx.state.usedWordIds[categoryId] = [];
    const lastId = ctx.state.lastWordIds[categoryId];
    available = words.filter((entry) => entry.id !== lastId);
    if (available.length === 0) available = [...words];
  }
  return available[Math.floor(ctx.random() * available.length)];
}

function revealHint(ctx, index, text) {
  if (ctx.state.phase !== 'drawing') return;
  ctx.state.revealedHints.push(text);
  addMessage(ctx, { type: 'hint', text: `提示 ${index}：${text}` });
}

function beginDrawing(ctx, categoryId) {
  if (ctx.state.phase !== 'choosing' || !WORD_BANK[categoryId]) return;
  ctx.clearTimer('pick');
  const chosen = pickUnusedWord(ctx, categoryId);
  if (!chosen) return;
  secretWord = chosen;
  secretWordId = chosen.id;
  resetStrokeUpdateLedger(classicStrokeLedger);
  ctx.state.phase = 'drawing';
  ctx.state.categoryId = categoryId;
  ctx.state.pickEndsAt = null;
  ctx.state.roundEndsAt = ctx.now() + ROUND_MS;
  ctx.state.revealedHints = [];
  ctx.state.guessedIds = [];
  ctx.state.roundPoints = {};
  ctx.state.strokes = [];
  ctx.state.activeStroke = null;
  ctx.state.canvasRevision += 1;
  ctx.send(ctx.state.drawerId, 'guess:word', { word: chosen.word, roundNumber: ctx.state.roundNumber });
  const category = CATEGORY_DEFS.find((entry) => entry.id === categoryId);
  addMessage(ctx, { type: 'system', text: `${ctx.state.players[ctx.state.drawerId]?.name || '画手'} 选择了「${category?.name}」。` });
  ctx.setTimer('hint-1', 30_000, () => revealHint(ctx, 1, `${[...chosen.word.replace(/\s/g, '')].length} 个字`));
  ctx.setTimer('hint-2', 55_000, () => revealHint(ctx, 2, chosen.hints[0]));
  ctx.setTimer('hint-3', 75_000, () => revealHint(ctx, 3, chosen.hints[1]));
  ctx.setTimer('round', ROUND_MS, () => endRound(ctx, 'timeout'));
}

function scoreForRemaining(remainingMs) {
  if (remainingMs > 60_000) return 20;
  if (remainingMs > 35_000) return 15;
  if (remainingMs > 15_000) return 10;
  return 5;
}

function allConnectedGuessersDone(state) {
  const eligible = state.roundGuessers.filter((id) => state.players[id]?.connected);
  return eligible.length > 0 && eligible.every((id) => state.guessedIds.includes(id));
}

function endRound(ctx, reason) {
  if (ctx.state.phase !== 'drawing' || !secretWord) return;
  clearGameTimers(ctx);
  const answer = secretWord.word;
  const categoryId = ctx.state.categoryId;
  const used = ctx.state.usedWordIds[categoryId] || [];
  if (!used.includes(secretWordId)) used.push(secretWordId);
  ctx.state.usedWordIds[categoryId] = used;
  ctx.state.lastWordIds[categoryId] = secretWordId;
  ctx.state.phase = 'round-result';
  ctx.state.roundEndsAt = null;
  ctx.state.roundResult = {
    answer,
    reason,
    drawerId: ctx.state.drawerId,
    points: { ...ctx.state.roundPoints },
  };
  resetStrokeUpdateLedger(classicStrokeLedger);
  ctx.state.activeStroke = null;
  addMessage(ctx, { type: 'answer', text: `答案是「${answer}」` });
  secretWord = null;
  secretWordId = null;
  ctx.setTimer('result', RESULT_MS, () => advanceTurn(ctx));
}

function allowedStrokeAction(playerId, now) {
  const bucket = strokeRate.get(playerId) || { since: now, count: 0 };
  if (now - bucket.since >= 1_000) {
    bucket.since = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  strokeRate.set(playerId, bucket);
  return bucket.count <= 35;
}

function clearRelayTimers(ctx) {
  ['relay-pick', 'relay-stage'].forEach((name) => ctx.clearTimer(name));
}

function relayParticipants(ctx) {
  return ctx.state.relayParticipants || [];
}

function relayAllSubmitted(ctx) {
  return relayParticipants(ctx).every((id) => ctx.state.relaySubmittedIds.includes(id));
}

function relayWordForCategory(ctx, categoryId) {
  const words = WORD_BANK[categoryId] || [];
  const used = new Set(ctx.state.usedWordIds[categoryId] || []);
  let available = words.filter((entry) => !used.has(entry.id) && !relayReservedWordIds.has(entry.id));
  if (!available.length) {
    const lastId = ctx.state.lastWordIds[categoryId];
    available = words.filter((entry) => !relayReservedWordIds.has(entry.id) && entry.id !== lastId);
    if (!available.length) available = words.filter((entry) => !relayReservedWordIds.has(entry.id));
  }
  if (!available.length) return null;
  const word = available[Math.floor(ctx.random() * available.length)];
  relayReservedWordIds.add(word.id);
  return word;
}

function assignRelayWord(ctx, playerId, categoryId) {
  if (ctx.state.phase !== 'relay-choosing' || relayChains.some((chain) => chain.originId === playerId)) return;
  const validCategory = WORD_BANK[categoryId] ? categoryId : CATEGORY_DEFS[Math.floor(ctx.random() * CATEGORY_DEFS.length)].id;
  const word = relayWordForCategory(ctx, validCategory);
  if (!word) return;
  relayChains.push({
    id: `chain-${playerId}`,
    originId: playerId,
    categoryId: validCategory,
    wordId: word.id,
    word: word.word,
    entries: [],
  });
  ctx.state.relaySubmittedIds.push(playerId);
  ctx.send(playerId, 'relay:task', { kind: 'choose-complete', word: word.word, taskId: `choose:${ctx.state.relayStep}` });
}

function startRelayGame(ctx) {
  clearGameTimers(ctx);
  clearRelayTimers(ctx);
  resetRoundRuntime();
  resetRelayRuntime();
  const players = connectedPlayers(ctx.state);
  const participants = shuffled(ctx, players.map((player) => player.id));
  ctx.state.phase = 'relay-choosing';
  ctx.state.relayParticipants = participants;
  ctx.state.relayStep = 0;
  ctx.state.relaySubmittedIds = [];
  ctx.state.relayDeadline = ctx.now() + PICK_MS;
  ctx.state.relayReveal = null;
  ctx.state.messages = [];
  ctx.state.scores = Object.fromEntries(players.map((player) => [player.id, 0]));
  Object.values(ctx.state.players).forEach((player) => { player.ready = false; });
  addMessage(ctx, { type: 'system', text: '接力画册开始！每个人先选择一个词语分类。' });
  ctx.setTimer('relay-pick', PICK_MS, () => {
    if (ctx.state.phase !== 'relay-choosing') return;
    participants.forEach((id) => {
      if (!relayChains.some((chain) => chain.originId === id)) assignRelayWord(ctx, id, null);
    });
    beginRelayInitialDrawing(ctx);
  });
}

function setRelayStageTimer(ctx, duration, callback) {
  ctx.state.relayDeadline = ctx.now() + duration;
  ctx.setTimer('relay-stage', duration, callback);
}

function resetRelaySubmissionState(ctx) {
  ctx.state.relaySubmittedIds = [];
  relayCanvases = new Map(relayParticipants(ctx).map((id) => [id, []]));
  relayStrokeDrafts = new Map();
  relayStrokeLedgers = new Map(relayParticipants(ctx).map((id) => [id, createStrokeUpdateLedger()]));
  ctx.state.canvasRevision += 1;
}

function beginRelayInitialDrawing(ctx) {
  ctx.clearTimer('relay-pick');
  ctx.state.phase = 'relay-initial-drawing';
  ctx.state.relayStep = 0;
  resetRelaySubmissionState(ctx);
  relayParticipants(ctx).forEach((id) => {
    const chain = relayChains.find((entry) => entry.originId === id);
    ctx.send(id, 'relay:task', { kind: 'draw', prompt: chain?.word || '未获得词语', strokes: [], taskId: 'draw:0' });
  });
  setRelayStageTimer(ctx, 60_000, () => completeRelayDrawingStage(ctx));
}

function assignmentForStep(ctx, playerId, step) {
  const participants = relayParticipants(ctx);
  const playerIndex = participants.indexOf(playerId);
  if (playerIndex < 0) return null;
  const originIndex = (playerIndex - step + participants.length) % participants.length;
  const originId = participants[originIndex];
  return relayChains.find((chain) => chain.originId === originId) || null;
}

function beginRelayGuessing(ctx, step) {
  const taskKind = relayTaskKind(relayParticipants(ctx).length, step);
  ctx.state.phase = taskKind === 'final-guess' ? 'relay-final-guess' : 'relay-guessing';
  ctx.state.relayStep = step;
  ctx.state.relaySubmittedIds = [];
  relayAssignments = new Map();
  relayGuesses = new Map();
  ctx.state.canvasRevision += 1;
  relayParticipants(ctx).forEach((playerId) => {
    const chain = assignmentForStep(ctx, playerId, step);
    relayAssignments.set(playerId, chain?.id);
    const drawing = [...(chain?.entries || [])].reverse().find((entry) => entry.kind === 'drawing');
    ctx.send(playerId, 'relay:task', {
      kind: taskKind,
      strokes: drawing?.strokes || [],
      step,
      total: relayParticipants(ctx).length - 1,
      taskId: `${taskKind}:${step}`,
    });
  });
  setRelayStageTimer(ctx, RELAY_GUESS_MS, () => completeRelayGuessStage(ctx));
}

function completeRelayGuessStage(ctx) {
  if (ctx.state.phase !== 'relay-guessing' && ctx.state.phase !== 'relay-final-guess') return;
  ctx.clearTimer('relay-stage');
  relayParticipants(ctx).forEach((playerId) => {
    const chainId = relayAssignments.get(playerId);
    const chain = relayChains.find((entry) => entry.id === chainId);
    if (!chain) return;
    const text = relayGuesses.get(playerId) || '未猜出';
    chain.entries.push({ kind: 'guess', playerId, text });
    relayGuesses.set(playerId, text);
  });
  if (ctx.state.phase === 'relay-final-guess') {
    beginRelayReveal(ctx);
  } else {
    beginRelayRedrawing(ctx);
  }
}

function beginRelayRedrawing(ctx) {
  ctx.state.phase = 'relay-redrawing';
  resetRelaySubmissionState(ctx);
  relayParticipants(ctx).forEach((playerId) => {
    ctx.send(playerId, 'relay:task', { kind: 'draw', prompt: relayGuesses.get(playerId) || '未猜出', strokes: [], taskId: `draw:${ctx.state.relayStep}` });
  });
  setRelayStageTimer(ctx, 60_000, () => completeRelayDrawingStage(ctx));
}

function completeRelayDrawingStage(ctx) {
  if (ctx.state.phase !== 'relay-initial-drawing' && ctx.state.phase !== 'relay-redrawing') return;
  ctx.clearTimer('relay-stage');
  const initial = ctx.state.phase === 'relay-initial-drawing';
  relayParticipants(ctx).forEach((playerId) => {
    const chain = initial
      ? relayChains.find((entry) => entry.originId === playerId)
      : relayChains.find((entry) => entry.id === relayAssignments.get(playerId));
    if (!chain) return;
    chain.entries.push({ kind: 'drawing', playerId, strokes: relayCanvases.get(playerId) || [] });
  });
  beginRelayGuessing(ctx, initial ? 1 : ctx.state.relayStep + 1);
}

function submitRelayDrawing(ctx, playerId) {
  if (ctx.state.relaySubmittedIds.includes(playerId)) return;
  ctx.state.relaySubmittedIds.push(playerId);
  ctx.send(playerId, 'relay:submitted', { kind: 'drawing' });
  if (relayAllSubmitted(ctx)) completeRelayDrawingStage(ctx);
}

function publicRelayItem(item) {
  if (item.kind === 'drawing') return { kind: 'drawing', playerId: item.playerId, strokes: item.strokes };
  return { kind: 'guess', playerId: item.playerId, text: item.text };
}

function revealChainPayload(chain) {
  return {
    id: chain.id,
    originId: chain.originId,
    word: chain.word,
    items: chain.entries.map(publicRelayItem),
  };
}

function beginRelayReveal(ctx) {
  clearRelayTimers(ctx);
  relayChains.forEach((chain) => {
    const used = ctx.state.usedWordIds[chain.categoryId] || [];
    if (!used.includes(chain.wordId)) used.push(chain.wordId);
    ctx.state.usedWordIds[chain.categoryId] = used;
    ctx.state.lastWordIds[chain.categoryId] = chain.wordId;
  });
  ctx.state.phase = 'relay-reveal';
  ctx.state.relayDeadline = null;
  ctx.state.relaySubmittedIds = [];
  ctx.state.relayReveal = {
    chainIndex: 0,
    itemIndex: -1,
    status: 'steps',
    current: { ...revealChainPayload(relayChains[0]), items: [] },
    gallery: null,
  };
  addMessage(ctx, { type: 'system', text: '所有画册完成，等待房主揭晓！' });
}

function advanceRelayReveal(ctx) {
  const reveal = ctx.state.relayReveal;
  if (ctx.state.phase !== 'relay-reveal' || !reveal) return;
  const chain = relayChains[reveal.chainIndex];
  if (!chain) return;
  if (reveal.status === 'steps') {
    if (reveal.itemIndex + 1 < chain.entries.length) {
      reveal.itemIndex += 1;
      reveal.current.items.push(publicRelayItem(chain.entries[reveal.itemIndex]));
      return;
    }
    reveal.status = 'summary';
    return;
  }
  if (reveal.chainIndex + 1 < relayChains.length) {
    reveal.chainIndex += 1;
    reveal.itemIndex = -1;
    reveal.status = 'steps';
    const next = relayChains[reveal.chainIndex];
    reveal.current = { ...revealChainPayload(next), items: [] };
    return;
  }
  ctx.state.phase = 'relay-gallery';
  reveal.status = 'gallery';
  reveal.gallery = relayChains.map(revealChainPayload);
  Object.values(ctx.state.players).forEach((player) => { player.ready = false; });
}

function sendCurrentRelayTask(ctx, playerId) {
  if (!relayParticipants(ctx).includes(playerId)) return;
  if (ctx.state.phase === 'relay-choosing') {
    const chain = relayChains.find((entry) => entry.originId === playerId);
    if (chain) ctx.send(playerId, 'relay:task', { kind: 'choose-complete', word: chain.word, taskId: `choose:${ctx.state.relayStep}` });
    return;
  }
  if (ctx.state.phase === 'relay-initial-drawing') {
    const chain = relayChains.find((entry) => entry.originId === playerId);
    ctx.send(playerId, 'relay:task', { kind: 'draw', prompt: chain?.word || '未获得词语', strokes: relayCanvases.get(playerId) || [], taskId: 'draw:0' });
    return;
  }
  if (ctx.state.phase === 'relay-guessing' || ctx.state.phase === 'relay-final-guess') {
    const chain = relayChains.find((entry) => entry.id === relayAssignments.get(playerId));
    const drawing = [...(chain?.entries || [])].reverse().find((entry) => entry.kind === 'drawing');
    const kind = ctx.state.phase === 'relay-final-guess' ? 'final-guess' : 'guess';
    ctx.send(playerId, 'relay:task', { kind, strokes: drawing?.strokes || [], taskId: `${kind}:${ctx.state.relayStep}` });
    return;
  }
  if (ctx.state.phase === 'relay-redrawing') {
    ctx.send(playerId, 'relay:task', { kind: 'draw', prompt: relayGuesses.get(playerId) || '未猜出', strokes: relayCanvases.get(playerId) || [], taskId: `draw:${ctx.state.relayStep}` });
  }
}

function sanitizeStroke(value) {
  if (!value || typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 48) return null;
  if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > MAX_POINTS_PER_STROKE || !value.points.every(isPoint)) return null;
  const tool = value.tool === 'eraser' ? 'eraser' : value.tool === 'pen' ? 'pen' : null;
  const colors = ['#172033', '#ef4444', '#f97316', '#22a06b', '#2563eb', '#7c3aed'];
  if (!tool || !colors.includes(value.color) || ![4, 8, 16].includes(value.size)) return null;
  return { id: value.id, tool, color: value.color, size: value.size, points: value.points.map(({ x, y, t }) => ({ x, y, ...(Number.isFinite(t) ? { t: Math.max(0, Math.min(60_000, t)) } : {}) })) };
}

function currentRelayDrawingTaskId(ctx) {
  if (ctx.state.phase === 'relay-initial-drawing') return 'draw:0';
  if (ctx.state.phase === 'relay-redrawing') return `draw:${ctx.state.relayStep}`;
  return null;
}

export default defineRoom({
  meta: { name: '你画我猜', minPlayers: 2, maxPlayers: 8 },

  initialState() {
    return {
      schema: 'guess-draw.v4',
      mode: 'classic',
      hostId: null,
      phase: 'lobby',
      players: {},
      scores: {},
      turnOrder: [],
      turnIndex: -1,
      roundNumber: 0,
      drawerId: null,
      categoryId: null,
      categories: categoriesForState(),
      pickEndsAt: null,
      roundEndsAt: null,
      revealedHints: [],
      roundGuessers: [],
      guessedIds: [],
      roundPoints: {},
      roundResult: null,
      messages: [],
      strokes: [],
      activeStroke: null,
      canvasRevision: 0,
      usedWordIds: createUsedWords(),
      lastWordIds: {},
      relayParticipants: [],
      relayStep: 0,
      relaySubmittedIds: [],
      relayDeadline: null,
      relayReveal: null,
    };
  },

  onJoin(ctx, player) {
    if (!ctx.state.hostId) ctx.state.hostId = ctx.host.id;
    ctx.state.players[player.id] = { id: player.id, name: player.name, connected: true, ready: false };
    if (!(player.id in ctx.state.scores)) ctx.state.scores[player.id] = 0;
    if (ctx.state.mode === 'relay' && ctx.state.phase !== 'lobby' && ctx.state.phase !== 'game-over') {
      addMessage(ctx, { type: 'system', text: `${player.name} 将在下一局加入。` });
    } else if (ctx.state.phase === 'drawing' || ctx.state.phase === 'choosing') {
      if (player.id !== ctx.state.drawerId && !ctx.state.roundGuessers.includes(player.id)) {
        ctx.state.roundGuessers.push(player.id);
      }
      addMessage(ctx, { type: 'system', text: `${player.name} 加入了本回合。` });
    }
  },

  onLeave(ctx, player) {
    const record = ctx.state.players[player.id];
    if (!record) return;
    if (ctx.state.phase === 'lobby' || ctx.state.phase === 'game-over') {
      delete ctx.state.players[player.id];
      delete ctx.state.scores[player.id];
      maybeStartGame(ctx);
    } else {
      record.connected = false;
      record.ready = false;
      addMessage(ctx, { type: 'system', text: `${record.name} 暂时离开了房间。` });
    }
  },

  onReconnect(ctx, player) {
    const record = ctx.state.players[player.id];
    if (record) {
      record.connected = true;
      record.name = player.name;
    } else {
      ctx.state.players[player.id] = { id: player.id, name: player.name, connected: true, ready: false };
      ctx.state.scores[player.id] = 0;
    }
    if (ctx.state.mode === 'relay' && ctx.state.phase.startsWith('relay-')) {
      if (ctx.state.phase === 'relay-initial-drawing' || ctx.state.phase === 'relay-redrawing') {
        relayStrokeDrafts.delete(player.id);
        const ledger = relayStrokeLedgers.get(player.id) || createStrokeUpdateLedger();
        resetStrokeUpdateLedger(ledger); relayStrokeLedgers.set(player.id, ledger);
      }
      sendCurrentRelayTask(ctx, player.id);
    } else if (ctx.state.phase === 'drawing' && player.id === ctx.state.drawerId && secretWord) {
      ctx.state.activeStroke = null;
      resetStrokeUpdateLedger(classicStrokeLedger);
      ctx.send(player.id, 'guess:word', { word: secretWord.word, roundNumber: ctx.state.roundNumber });
    }
  },

  onRestore(ctx) {
    clearGameTimers(ctx);
    resetRoundRuntime();
    if (ctx.state.mode === 'relay' && (ctx.state.phase.startsWith('relay-'))) {
      clearRelayTimers(ctx);
      resetRelayRuntime();
      ctx.state.phase = 'lobby';
      ctx.state.relayParticipants = [];
      ctx.state.relaySubmittedIds = [];
      ctx.state.relayDeadline = null;
      ctx.state.relayReveal = null;
      ctx.state.activeStroke = null;
      Object.values(ctx.state.players).forEach((record) => { record.ready = false; });
      addMessage(ctx, { type: 'system', text: '房间恢复后私密画册已作废，请重新准备。' });
    } else if (ctx.state.phase === 'drawing' || ctx.state.phase === 'choosing' || ctx.state.phase === 'round-result') {
      const drawer = ctx.state.players[ctx.state.drawerId];
      if (drawer?.connected) {
        addMessage(ctx, { type: 'system', text: '房间已恢复，本题作废并重新选词。' });
        beginChoosing(ctx, drawer.id);
      } else {
        advanceTurn(ctx);
      }
    }
  },

  actions: {
    selectMode(ctx, { player, payload }) {
      if (ctx.state.phase !== 'lobby' && ctx.state.phase !== 'game-over' && ctx.state.phase !== 'relay-gallery') return;
      if (player.id !== ctx.host.id) return;
      const mode = payload?.mode;
      if (mode !== 'classic' && mode !== 'relay') return;
      ctx.state.mode = mode;
      if (ctx.state.phase === 'relay-gallery') ctx.state.phase = 'game-over';
      maybeStartGame(ctx);
    },

    toggleReady(ctx, { player }) {
      if (ctx.state.phase !== 'lobby' && ctx.state.phase !== 'game-over' && ctx.state.phase !== 'relay-gallery') return;
      const record = ctx.state.players[player.id];
      if (!record?.connected) return;
      record.ready = !record.ready;
      maybeStartGame(ctx);
    },

    chooseCategory(ctx, { player, payload }) {
      if (ctx.state.phase === 'relay-choosing') {
        if (!relayParticipants(ctx).includes(player.id) || ctx.state.relaySubmittedIds.includes(player.id)) return;
        assignRelayWord(ctx, player.id, payload?.categoryId);
        if (relayAllSubmitted(ctx)) beginRelayInitialDrawing(ctx);
        return;
      }
      if (ctx.state.phase !== 'choosing' || player.id !== ctx.state.drawerId) return;
      if (!payload || typeof payload.categoryId !== 'string') return;
      beginDrawing(ctx, payload.categoryId);
    },

    submitGuess(ctx, { player, payload }) {
      if (ctx.state.phase === 'relay-guessing' || ctx.state.phase === 'relay-final-guess') {
        if (!relayParticipants(ctx).includes(player.id) || ctx.state.relaySubmittedIds.includes(player.id)) return;
        const text = cleanText(payload?.text) || '未猜出';
        relayGuesses.set(player.id, text);
        ctx.state.relaySubmittedIds.push(player.id);
        ctx.send(player.id, 'relay:submitted', { kind: 'guess', text });
        if (relayAllSubmitted(ctx)) completeRelayGuessStage(ctx);
        return;
      }
      if (ctx.state.phase !== 'drawing' || player.id === ctx.state.drawerId || !secretWord) return;
      if (!ctx.state.roundGuessers.includes(player.id)) return;
      const now = ctx.now();
      const last = lastChatAt.get(player.id) || 0;
      if (now - last < 650) {
        ctx.send(player.id, 'guess:notice', { text: '慢一点再发送。' });
        return;
      }
      lastChatAt.set(player.id, now);
      const text = cleanText(payload?.text);
      if (!text) return;
      const guess = comparable(text);
      const answer = comparable(secretWord.word);
      const alreadyCorrect = ctx.state.guessedIds.includes(player.id);
      if (!alreadyCorrect && guess === answer) {
        const points = scoreForRemaining(Math.max(0, ctx.state.roundEndsAt - now));
        ctx.state.guessedIds.push(player.id);
        ctx.state.scores[player.id] = (ctx.state.scores[player.id] || 0) + points;
        ctx.state.scores[ctx.state.drawerId] = (ctx.state.scores[ctx.state.drawerId] || 0) + 2;
        ctx.state.roundPoints[player.id] = points;
        ctx.state.roundPoints[ctx.state.drawerId] = (ctx.state.roundPoints[ctx.state.drawerId] || 0) + 2;
        addMessage(ctx, { type: 'correct', playerId: player.id, text: `${ctx.state.players[player.id]?.name || player.name} 猜对了！` });
        ctx.send(player.id, 'guess:notice', { text: `猜对了，+${points} 分！`, tone: 'success' });
        if (allConnectedGuessersDone(ctx.state)) endRound(ctx, 'all-guessed');
        return;
      }
      if (answer && guess.includes(answer)) {
        ctx.send(player.id, 'guess:notice', { text: '这条消息可能泄露答案，未发送。' });
        return;
      }
      addMessage(ctx, {
        type: 'chat',
        playerId: player.id,
        name: ctx.state.players[player.id]?.name || player.name,
        text,
      });
    },

    submitStroke(ctx, { player, payload }) {
      const rawSummary = { playerId: player.id, strokeId: typeof payload?.stroke?.id === 'string' ? payload.stroke.id : null, updateSeq: payload?.updateSeq, pointCount: Array.isArray(payload?.stroke?.points) ? payload.stroke.points.length : null, canvasRevision: payload?.canvasRevision, expectedCanvasRevision: ctx.state.canvasRevision, taskId: payload?.taskId ?? null, complete: payload?.complete };
      if (!allowedStrokeAction(player.id, ctx.now())) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'rate-limit' }); return; }
      if (payload?.canvasRevision !== ctx.state.canvasRevision) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'canvas-revision' }); return; }
      const stroke = sanitizeStroke(payload?.stroke);
      if (!stroke) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'invalid-stroke' }); return; }
      if (typeof payload.complete !== 'boolean') { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'invalid-complete' }); return; }
      if (ctx.state.phase === 'relay-initial-drawing' || ctx.state.phase === 'relay-redrawing') {
        if (!relayParticipants(ctx).includes(player.id)) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'relay-not-participant' }); return; }
        if (ctx.state.relaySubmittedIds.includes(player.id)) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'relay-already-submitted' }); return; }
        if (payload.taskId !== currentRelayDrawingTaskId(ctx)) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'relay-task-id', expectedTaskId: currentRelayDrawingTaskId(ctx) }); return; }
        const strokes = relayCanvases.get(player.id) || [];
        const ledger = relayStrokeLedgers.get(player.id) || createStrokeUpdateLedger();
        relayStrokeLedgers.set(player.id, ledger);
        if (!canApplyStroke(strokes, stroke)) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'canvas-budget' }); return; }
        if (!acceptStrokeUpdate(ledger, { stroke, updateSeq: payload.updateSeq, complete: payload.complete })) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'stroke-ledger' }); return; }
        if (payload.complete) {
          strokes.push(stroke); relayCanvases.set(player.id, strokes); relayStrokeDrafts.delete(player.id);
        } else relayStrokeDrafts.set(player.id, stroke);
        ctx.log('[DRAW-SYNC]', 'worker-accept', { ...rawSummary, target: payload.complete ? 'relay-completed' : 'relay-draft' });
        return;
      }
      if (ctx.state.phase !== 'drawing') { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'classic-phase', phase: ctx.state.phase }); return; }
      if (player.id !== ctx.state.drawerId) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'classic-not-drawer', drawerId: ctx.state.drawerId }); return; }
      if (payload.taskId != null) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'classic-task-id' }); return; }
      if (!canApplyStroke(ctx.state.strokes, stroke)) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'canvas-budget' }); return; }
      if (!acceptStrokeUpdate(classicStrokeLedger, { stroke, updateSeq: payload.updateSeq, complete: payload.complete })) { ctx.log('[DRAW-SYNC]', 'worker-reject', { ...rawSummary, reason: 'stroke-ledger' }); return; }
      if (payload.complete) { ctx.state.strokes.push(stroke); ctx.state.activeStroke = null; }
      else ctx.state.activeStroke = stroke;
      ctx.log('[DRAW-SYNC]', 'worker-accept', { ...rawSummary, target: payload.complete ? 'classic-completed' : 'classic-active', completedStrokes: ctx.state.strokes.length, activePoints: ctx.state.activeStroke?.points.length ?? 0 });
    },

    clearCanvas(ctx, { player, payload }) {
      if (ctx.state.phase === 'relay-initial-drawing' || ctx.state.phase === 'relay-redrawing') {
        if (!relayParticipants(ctx).includes(player.id) || ctx.state.relaySubmittedIds.includes(player.id) || payload?.taskId !== currentRelayDrawingTaskId(ctx)) return;
        relayStrokeDrafts.delete(player.id);
        const ledger = relayStrokeLedgers.get(player.id) || createStrokeUpdateLedger();
        resetStrokeUpdateLedger(ledger); relayStrokeLedgers.set(player.id, ledger);
        relayCanvases.set(player.id, []);
        return;
      }
      if (ctx.state.phase !== 'drawing' || player.id !== ctx.state.drawerId || payload?.taskId != null) return;
      resetStrokeUpdateLedger(classicStrokeLedger);
      ctx.state.strokes = [];
      ctx.state.activeStroke = null;
      ctx.state.canvasRevision += 1;
    },

    relaySubmitDrawing(ctx, { player }) {
      if (ctx.state.phase !== 'relay-initial-drawing' && ctx.state.phase !== 'relay-redrawing') return;
      if (!relayParticipants(ctx).includes(player.id)) return;
      const draft = relayStrokeDrafts.get(player.id);
      if (draft) {
        const strokes = relayCanvases.get(player.id) || [];
        if (canApplyStroke(strokes, draft)) strokes.push(draft);
        relayCanvases.set(player.id, strokes); relayStrokeDrafts.delete(player.id);
      }
      submitRelayDrawing(ctx, player.id);
    },

    advanceReveal(ctx, { player }) {
      if (player.id !== ctx.host.id) return;
      advanceRelayReveal(ctx);
    },

    replayRevealDrawing(ctx, { player }) {
      if (player.id !== ctx.host.id || ctx.state.phase !== 'relay-reveal') return;
      ctx.broadcast('relay:replay', {});
    },

    sendReaction(ctx, { player, payload }) {
      if (ctx.state.phase !== 'relay-reveal' && ctx.state.phase !== 'relay-gallery') return;
      const emoji = ['😂', '🤯', '🎨', '👏', '❓'].includes(payload?.emoji) ? payload.emoji : null;
      if (!emoji) return;
      ctx.broadcast('relay:reaction', { playerId: player.id, emoji });
    },
  },
});
