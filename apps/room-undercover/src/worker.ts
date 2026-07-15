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
import { WORD_PAIRS, type Category } from './words';

type Player = { id: string; name: string; role: 'host' | 'player' | 'spectator' };
type PublicPlayer = { id: string; name: string; role: 'host' | 'player' };
type RoomState = {
  phase: 'waiting' | 'active' | 'finished';
  hostId: string | null;
  players: PublicPlayer[];
  selectedMode: DealMode;
  selectedIncludeBlank: boolean;
  roundMode: DealMode | null;
  selectedCategories: Category[];
  round: number;
  dealtPlayerIds: string[];
  eliminatedPlayerIds: string[];
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
  log(...args: unknown[]): void;
};

let currentDeal: DealResult | null = null;
const usedPairIds = new Set<string>();

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

export default defineRoom({
  meta: { name: '谁是卧底 · 发牌房', minPlayers: 3, maxPlayers: 12 },

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
      dealtPlayerIds: [],
      eliminatedPlayerIds: [],
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
    ctx.state.dealtPlayerIds = ctx.state.dealtPlayerIds.filter((id) => id !== player.id);
    ctx.state.players = ctx.state.players.filter(({ id }) => id !== player.id);
  },

  onReconnect(ctx: Context, player: Player) {
    syncPlayers(ctx);
    if (currentDeal?.cards[player.id] && !ctx.state.dealtPlayerIds.includes(player.id)) {
      ctx.state.dealtPlayerIds.push(player.id);
    }
    sendCard(ctx, player.id);
  },

  onRestore(ctx: Context) {
    currentDeal = null;
    usedPairIds.clear();
    ctx.state.phase = 'waiting';
    ctx.state.dealtPlayerIds = [];
    ctx.state.eliminatedPlayerIds = [];
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

      ctx.state.round += 1;
      ctx.state.phase = 'active';
      ctx.state.roundMode = mode;
      ctx.state.dealtPlayerIds = playerIds;
      ctx.state.eliminatedPlayerIds = [];
      ctx.state.revealedWords = null;
      ctx.state.winner = null;
      ctx.state.resultHadBlank = false;
      ctx.state.resultHadUndercover = false;
      ctx.state.notice = null;
      syncPlayers(ctx);
      for (const playerId of playerIds) sendCard(ctx, playerId);
      ctx.log('undercover round dealt', ctx.state.round, playerIds.length);
    },

    'round:eliminateSelf'(ctx: Context, event: { player: Player }) {
      if (ctx.state.phase !== 'active') return;
      const playerId = event.player.id;
      const isPresent = ctx.players.some((player) => player.id === playerId && player.role !== 'spectator');
      if (!isPresent || !ctx.state.dealtPlayerIds.includes(playerId) || !currentDeal?.cards[playerId]) return;
      if (ctx.state.eliminatedPlayerIds.includes(playerId)) return;

      ctx.state.eliminatedPlayerIds.push(playerId);
      const result = resolveElimination(currentDeal, ctx.state.eliminatedPlayerIds);
      if (result.finished) {
        ctx.state.phase = 'finished';
        ctx.state.revealedWords = result.revealedWords;
        ctx.state.winner = result.winner;
        ctx.state.resultHadBlank = result.hadBlank;
        ctx.state.resultHadUndercover = result.hadUndercover;
      }
    },
  },
});
