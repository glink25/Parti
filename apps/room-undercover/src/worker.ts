import { defineRoom } from '@parti/worker-sdk';
import {
  choosePair,
  dealCards,
  dealCardsWithWords,
  eligiblePairs,
  normalizeCategories,
  normalizeCustomWords,
  participantIds,
  privateCardPayload,
  resolveElimination,
  type DealResult,
  type DealMode,
  type RevealedWords,
  type Winner,
} from './game-logic';
import { livingSpeakingOrder, resolveVote } from './round-flow';
import type { Category } from './categories';
import { WORD_PAIRS } from './word-bank';

type Player = { id: string; name: string; role: 'host' | 'player' | 'spectator' };
type PublicPlayer = { id: string; name: string; role: 'host' | 'player' };
type Phase = 'waiting' | 'speaking' | 'transition' | 'voting' | 'finished';
type ChatKind = 'chat' | 'speech' | 'system';
type ChatMessage = { id: string; playerId: string; name: string; text: string; at: number; kind: ChatKind };
type RoomState = {
  phase: Phase;
  hostId: string | null;
  players: PublicPlayer[];
  selectedMode: DealMode;
  selectedIncludeBlank: boolean;
  roundMode: DealMode | null;
  selectedCategories: Category[];
  round: number;
  voteRound: number;
  dealtPlayerIds: string[];
  eliminatedPlayerIds: string[];
  speakingOrder: string[];
  speakingIndex: number;
  currentSpeakerId: string | null;
  spokenPlayerIds: string[];
  votes: Record<string, string>;
  voteCandidates: string[];
  revoteTied: boolean;
  lastEliminatedId: string | null;
  chat: ChatMessage[];
  revealedWords: RevealedWords | null;
  winner: Winner | null;
  resultHadBlank: boolean;
  resultHadUndercover: boolean;
  notice: string | null;
};
type Context = {
  state: RoomState;
  players: Player[];
  host: Player;
  random(): number;
  send(playerId: string, event: string, payload?: unknown): void;
  setTimer(name: string, ms: number, callback: () => void): void;
  clearTimer(name: string): void;
  log(...args: unknown[]): void;
};

const CHAT_LIMIT = 80;
const TEXT_MAX = 200;
const TRANSITION_MS = 1500;

let currentDeal: DealResult | null = null;
const usedPairIds = new Set<string>();
let msgSeq = 0;

function syncPlayers(ctx: Context) {
  ctx.state.hostId = ctx.host?.id ?? null;
  ctx.state.players = ctx.players
    .filter((player) => player.role !== 'spectator')
    .map(({ id, name, role }) => ({ id, name, role: role === 'host' ? 'host' : 'player' }));
}

function isHost(ctx: Context, player: Player) {
  return player.id === ctx.host?.id;
}

function sendCard(ctx: Context, playerId: string) {
  const card = currentDeal?.cards[playerId];
  if (!card) return;
  ctx.send(playerId, 'undercover:card', privateCardPayload(card, ctx.state.round));
}

function livingIds(state: RoomState): string[] {
  const eliminated = new Set(state.eliminatedPlayerIds);
  return state.dealtPlayerIds.filter((id) => !eliminated.has(id));
}

function nameOf(ctx: Context, playerId: string): string {
  return ctx.state.players.find((player) => player.id === playerId)?.name ?? '玩家';
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, TEXT_MAX);
}

function pushMessage(ctx: Context, playerId: string, kind: ChatKind, text: string) {
  ctx.state.chat.push({ id: `m${(msgSeq += 1)}`, playerId, name: kind === 'system' ? '系统' : nameOf(ctx, playerId), text, at: Date.now(), kind });
  if (ctx.state.chat.length > CHAT_LIMIT) ctx.state.chat.splice(0, ctx.state.chat.length - CHAT_LIMIT);
}

function pushSystem(ctx: Context, text: string) {
  ctx.state.chat.push({ id: `m${(msgSeq += 1)}`, playerId: '', name: '系统', text, at: Date.now(), kind: 'system' });
  if (ctx.state.chat.length > CHAT_LIMIT) ctx.state.chat.splice(0, ctx.state.chat.length - CHAT_LIMIT);
}

function beginSpeaking(ctx: Context) {
  const order = livingSpeakingOrder(ctx.state.dealtPlayerIds, ctx.state.eliminatedPlayerIds, ctx.state.voteRound - 1);
  ctx.state.speakingOrder = order;
  ctx.state.speakingIndex = 0;
  ctx.state.currentSpeakerId = order[0] ?? null;
  ctx.state.spokenPlayerIds = [];
  ctx.state.votes = {};
  ctx.state.voteCandidates = [];
  ctx.state.revoteTied = false;
  ctx.state.notice = null;
  ctx.state.phase = order.length ? 'speaking' : 'voting';
  if (!order.length) beginVoting(ctx, livingIds(ctx.state), false);
  else pushSystem(ctx, `第 ${ctx.state.voteRound} 轮发言开始，由 ${nameOf(ctx, order[0]!)} 起始。`);
}

function toTransition(ctx: Context) {
  ctx.state.phase = 'transition';
  ctx.state.currentSpeakerId = null;
  ctx.state.notice = '发言结束，即将进入投票';
  pushSystem(ctx, '全员发言完毕，即将投票。');
  ctx.setTimer('undercover:transition', TRANSITION_MS, () => {
    if (ctx.state.phase !== 'transition') return;
    beginVoting(ctx, livingIds(ctx.state), false);
  });
}

function beginVoting(ctx: Context, candidates: string[], isRevote: boolean) {
  ctx.state.phase = 'voting';
  ctx.state.currentSpeakerId = null;
  ctx.state.votes = {};
  ctx.state.voteCandidates = candidates;
  ctx.state.revoteTied = isRevote;
  ctx.state.notice = isRevote ? '平票重投，仅可在并列者中选择' : '开始投票';
}

function advanceSpeaker(ctx: Context) {
  const order = ctx.state.speakingOrder;
  const eliminated = new Set(ctx.state.eliminatedPlayerIds);
  let index = ctx.state.speakingIndex + 1;
  while (index < order.length && eliminated.has(order[index]!)) index += 1;
  ctx.state.speakingIndex = index;
  if (index < order.length) ctx.state.currentSpeakerId = order[index]!;
  else toTransition(ctx);
}

function applyElimination(ctx: Context, targetId: string) {
  ctx.state.eliminatedPlayerIds.push(targetId);
  ctx.state.lastEliminatedId = targetId;
  pushSystem(ctx, `${nameOf(ctx, targetId)} 被投票出局。`);
  const result = resolveElimination(currentDeal!, ctx.state.eliminatedPlayerIds);
  if (result.finished) {
    ctx.state.phase = 'finished';
    ctx.state.currentSpeakerId = null;
    ctx.state.revealedWords = result.revealedWords;
    ctx.state.winner = result.winner;
    ctx.state.resultHadBlank = result.hadBlank;
    ctx.state.resultHadUndercover = result.hadUndercover;
    pushSystem(ctx, '本局结束，身份揭晓。');
    return;
  }
  ctx.state.voteRound += 1;
  beginSpeaking(ctx);
}

function resolveVotingRound(ctx: Context) {
  const living = livingIds(ctx.state);
  const votedCount = living.filter((id) => id in ctx.state.votes).length;
  if (votedCount < living.length) return;
  const outcome = resolveVote(ctx.state.votes, ctx.state.voteCandidates);
  if (outcome.eliminatedId) {
    applyElimination(ctx, outcome.eliminatedId);
    return;
  }
  if (outcome.tie && !ctx.state.revoteTied) {
    pushSystem(ctx, `平票（${outcome.leaders.map((id) => nameOf(ctx, id)).join('、')}），在并列者中重投一次。`);
    beginVoting(ctx, outcome.leaders, true);
    return;
  }
  pushSystem(ctx, '本轮无人出局，进入下一轮发言。');
  ctx.state.voteRound += 1;
  beginSpeaking(ctx);
}

function handleLeaveDuringGame(ctx: Context, leaverId: string) {
  if (ctx.state.eliminatedPlayerIds.includes(leaverId)) return;
  ctx.state.eliminatedPlayerIds.push(leaverId);
  delete ctx.state.votes[leaverId];
  pushSystem(ctx, `${nameOf(ctx, leaverId)} 离开了牌局。`);
  const result = resolveElimination(currentDeal!, ctx.state.eliminatedPlayerIds);
  if (result.finished) {
    ctx.state.phase = 'finished';
    ctx.state.currentSpeakerId = null;
    ctx.state.revealedWords = result.revealedWords;
    ctx.state.winner = result.winner;
    ctx.state.resultHadBlank = result.hadBlank;
    ctx.state.resultHadUndercover = result.hadUndercover;
    return;
  }
  if (ctx.state.phase === 'speaking' && ctx.state.currentSpeakerId === leaverId) {
    advanceSpeaker(ctx);
  } else if (ctx.state.phase === 'voting') {
    ctx.state.voteCandidates = ctx.state.voteCandidates.filter((id) => id !== leaverId);
    resolveVotingRound(ctx);
  }
}

export default defineRoom({
  meta: { name: '谁是卧底', minPlayers: 3, maxPlayers: 12 },

  initialState(): RoomState {
    return {
      phase: 'waiting',
      hostId: null,
      players: [],
      selectedMode: 'classic',
      selectedIncludeBlank: false,
      roundMode: null,
      selectedCategories: ['entertainment', 'daily'],
      round: 0,
      voteRound: 0,
      dealtPlayerIds: [],
      eliminatedPlayerIds: [],
      speakingOrder: [],
      speakingIndex: 0,
      currentSpeakerId: null,
      spokenPlayerIds: [],
      votes: {},
      voteCandidates: [],
      revoteTied: false,
      lastEliminatedId: null,
      chat: [],
      revealedWords: null,
      winner: null,
      resultHadBlank: false,
      resultHadUndercover: false,
      notice: null,
    };
  },

  onJoin(ctx: Context) {
    syncPlayers(ctx);
  },

  onLeave(ctx: Context, player: Player) {
    const wasDealtLiving = ctx.state.dealtPlayerIds.includes(player.id) && !ctx.state.eliminatedPlayerIds.includes(player.id);
    const active = ctx.state.phase === 'speaking' || ctx.state.phase === 'transition' || ctx.state.phase === 'voting';
    ctx.state.players = ctx.state.players.filter(({ id }) => id !== player.id);
    if (active && wasDealtLiving && currentDeal) {
      handleLeaveDuringGame(ctx, player.id);
    } else if (!active) {
      ctx.state.dealtPlayerIds = ctx.state.dealtPlayerIds.filter((id) => id !== player.id);
    }
  },

  onReconnect(ctx: Context, player: Player) {
    syncPlayers(ctx);
    sendCard(ctx, player.id);
  },

  onRestore(ctx: Context) {
    currentDeal = null;
    usedPairIds.clear();
    ctx.state.phase = 'waiting';
    ctx.state.round = 0;
    ctx.state.voteRound = 0;
    ctx.state.dealtPlayerIds = [];
    ctx.state.eliminatedPlayerIds = [];
    ctx.state.speakingOrder = [];
    ctx.state.speakingIndex = 0;
    ctx.state.currentSpeakerId = null;
    ctx.state.spokenPlayerIds = [];
    ctx.state.votes = {};
    ctx.state.voteCandidates = [];
    ctx.state.revoteTied = false;
    ctx.state.lastEliminatedId = null;
    ctx.state.chat = [];
    ctx.state.revealedWords = null;
    ctx.state.winner = null;
    ctx.state.resultHadBlank = false;
    ctx.state.resultHadUndercover = false;
    ctx.state.roundMode = null;
    ctx.state.notice = '房间已恢复，请房主重新发牌';
    syncPlayers(ctx);
  },

  actions: {
    'settings:setMode'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (!isHost(ctx, event.player)) return;
      const mode = (event.payload as { mode?: unknown } | null)?.mode;
      if (mode !== 'classic' && mode !== 'custom') return;
      ctx.state.selectedMode = mode;
      ctx.state.notice = null;
    },

    'settings:setIncludeBlank'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (!isHost(ctx, event.player)) return;
      const enabled = (event.payload as { enabled?: unknown } | null)?.enabled;
      if (typeof enabled !== 'boolean') return;
      ctx.state.selectedIncludeBlank = enabled;
      ctx.state.notice = null;
    },

    'settings:setCategories'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (!isHost(ctx, event.player)) return;
      const payload = event.payload as { categories?: unknown } | null;
      const categories = normalizeCategories(payload?.categories);
      if (!categories) return;
      ctx.state.selectedCategories = categories;
      ctx.state.notice = null;
    },

    'round:deal'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (!isHost(ctx, event.player)) return;
      const mode = ctx.state.selectedMode;
      const playerIds = participantIds(ctx.players, mode);
      if (playerIds.length < 3) {
        ctx.state.notice = mode === 'classic'
          ? '至少需要 3 名玩家才能发牌'
          : '主持模式至少需要 3 名非房主玩家';
        return;
      }

      if (mode === 'custom') {
        const words = normalizeCustomWords(event.payload);
        if (!words) {
          ctx.state.notice = '请填写两个不同且不超过 20 个字的自定义词语';
          return;
        }
        currentDeal = dealCardsWithWords(playerIds, words, () => ctx.random(), ctx.state.selectedIncludeBlank);
      } else {
        const candidates = eligiblePairs(WORD_PAIRS, ctx.state.selectedCategories);
        const { pair, reset } = choosePair(candidates, usedPairIds, () => ctx.random());
        if (reset) {
          for (const candidate of candidates) usedPairIds.delete(candidate.id);
        }
        usedPairIds.add(pair.id);
        currentDeal = dealCards(playerIds, pair, () => ctx.random(), ctx.state.selectedIncludeBlank);
      }

      ctx.clearTimer('undercover:transition');
      ctx.state.round += 1;
      ctx.state.voteRound = 1;
      ctx.state.roundMode = mode;
      ctx.state.dealtPlayerIds = playerIds;
      ctx.state.eliminatedPlayerIds = [];
      ctx.state.lastEliminatedId = null;
      ctx.state.revealedWords = null;
      ctx.state.winner = null;
      ctx.state.resultHadBlank = false;
      ctx.state.resultHadUndercover = false;
      ctx.state.chat = [];
      ctx.state.notice = null;
      syncPlayers(ctx);
      for (const playerId of playerIds) sendCard(ctx, playerId);
      pushSystem(ctx, `第 ${ctx.state.round} 轮发牌完成，${playerIds.length} 人参与。`);
      beginSpeaking(ctx);
      ctx.log('undercover round dealt', ctx.state.round, playerIds.length);
    },

    speak(ctx: Context, event: { player: Player; payload: unknown }) {
      if (ctx.state.phase !== 'speaking' || ctx.state.currentSpeakerId !== event.player.id) return;
      const text = normalizeText((event.payload as { text?: unknown } | null)?.text);
      if (!text) return;
      pushMessage(ctx, event.player.id, 'speech', text);
      ctx.state.spokenPlayerIds.push(event.player.id);
      advanceSpeaker(ctx);
    },

    vote(ctx: Context, event: { player: Player; payload: unknown }) {
      if (ctx.state.phase !== 'voting') return;
      if (!livingIds(ctx.state).includes(event.player.id)) return;
      if (event.player.id in ctx.state.votes) return;
      const raw = (event.payload as { targetId?: unknown } | null)?.targetId;
      const targetId = typeof raw === 'string' ? raw : '';
      if (targetId && (!ctx.state.voteCandidates.includes(targetId) || targetId === event.player.id)) return;
      ctx.state.votes[event.player.id] = targetId;
      pushSystem(ctx, targetId ? `${nameOf(ctx, event.player.id)} 投给了 ${nameOf(ctx, targetId)}。` : `${nameOf(ctx, event.player.id)} 弃票。`);
      resolveVotingRound(ctx);
    },

    chat(ctx: Context, event: { player: Player; payload: unknown }) {
      if (!livingIds(ctx.state).includes(event.player.id)) return;
      const text = normalizeText((event.payload as { text?: unknown } | null)?.text);
      if (!text) return;
      pushMessage(ctx, event.player.id, 'chat', text);
    },
  },
});
