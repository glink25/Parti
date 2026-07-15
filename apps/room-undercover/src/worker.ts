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
  type Card,
  type DealMode,
  type RevealedWords,
} from './game-logic';
import { WORD_PAIRS, type Category } from './words';

type Player = { id: string; name: string; role: 'host' | 'player' | 'spectator' };
type PublicPlayer = { id: string; name: string; role: 'host' | 'player' };
type RoomState = {
  phase: 'waiting' | 'active' | 'finished';
  hostId: string | null;
  players: PublicPlayer[];
  selectedMode: DealMode;
  roundMode: DealMode | null;
  selectedCategories: Category[];
  round: number;
  dealtPlayerIds: string[];
  eliminatedPlayerIds: string[];
  revealedWords: RevealedWords | null;
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

let currentCards: Record<string, Card> = {};
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
  const card = currentCards[playerId];
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
      roundMode: null,
      selectedCategories: ['entertainment', 'daily'],
      round: 0,
      dealtPlayerIds: [],
      eliminatedPlayerIds: [],
      revealedWords: null,
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
    if (currentCards[player.id] && !ctx.state.dealtPlayerIds.includes(player.id)) {
      ctx.state.dealtPlayerIds.push(player.id);
    }
    sendCard(ctx, player.id);
  },

  onRestore(ctx: Context) {
    currentCards = {};
    usedPairIds.clear();
    ctx.state.phase = 'waiting';
    ctx.state.dealtPlayerIds = [];
    ctx.state.eliminatedPlayerIds = [];
    ctx.state.revealedWords = null;
    ctx.state.roundMode = null;
    ctx.state.notice = '房间已恢复，请房主重新发牌';
    syncPlayers(ctx);
  },

  actions: {
    'settings:setMode'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (!isHost(ctx, event.player)) return;
      const mode = (event.payload as { mode?: unknown } | null)?.mode;
      if (mode !== 'classic' && mode !== 'blank' && mode !== 'custom') return;
      ctx.state.selectedMode = mode;
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
        currentCards = dealCardsWithWords(playerIds, words, () => ctx.random());
      } else {
        const candidates = eligiblePairs(WORD_PAIRS, ctx.state.selectedCategories);
        const { pair, reset } = choosePair(candidates, usedPairIds, () => ctx.random());
        if (reset) {
          for (const candidate of candidates) usedPairIds.delete(candidate.id);
        }
        usedPairIds.add(pair.id);
        if (mode === 'blank') {
          const civilian = ctx.random() < 0.5 ? pair.civilian : pair.undercover;
          currentCards = dealCardsWithWords(
            playerIds,
            { civilian, undercover: '' },
            () => ctx.random(),
          );
        } else {
          currentCards = dealCards(playerIds, pair, () => ctx.random());
        }
      }

      ctx.state.round += 1;
      ctx.state.phase = 'active';
      ctx.state.roundMode = mode;
      ctx.state.dealtPlayerIds = playerIds;
      ctx.state.eliminatedPlayerIds = [];
      ctx.state.revealedWords = null;
      ctx.state.notice = null;
      syncPlayers(ctx);
      for (const playerId of playerIds) sendCard(ctx, playerId);
      ctx.log('undercover round dealt', ctx.state.round, playerIds.length);
    },

    'round:eliminateSelf'(ctx: Context, event: { player: Player }) {
      if (ctx.state.phase !== 'active') return;
      const playerId = event.player.id;
      const isPresent = ctx.players.some((player) => player.id === playerId && player.role !== 'spectator');
      if (!isPresent || !ctx.state.dealtPlayerIds.includes(playerId) || !currentCards[playerId]) return;
      if (ctx.state.eliminatedPlayerIds.includes(playerId)) return;

      ctx.state.eliminatedPlayerIds.push(playerId);
      const result = resolveElimination(currentCards, ctx.state.eliminatedPlayerIds);
      if (result.finished) {
        ctx.state.phase = 'finished';
        ctx.state.revealedWords = result.revealedWords;
      }
    },
  },
});
