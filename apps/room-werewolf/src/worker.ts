import { defineRoom } from '@parti/worker-sdk';
import {
  DEFAULT_RULES, RECOMMENDED_DECKS, addDeathsWithHeartbreak, canWitchSelfSave, daySpeechOrder, dealRoles,
  privateRolePayload, resolveNightDeaths, resolveWinner, tallyVotes, validateDeck, voteLeaders,
  type DeathCause, type DeathRecord, type PlayerCard, type Role, type RuleSettings,
} from './game-logic';

type Player = { id: string; name: string; role: 'host' | 'player' | 'spectator' };
type PublicPlayer = { id: string; name: string; role: 'host' | 'player' };
type Stage = 'waiting' | 'role-check' | 'cupid' | 'guard' | 'werewolf' | 'witch' | 'seer' |
  'sheriff-signup' | 'sheriff-withdraw' | 'sheriff-vote' | 'dawn' | 'hunter' |
  'badge-transfer' | 'day-speech' | 'day-vote' | 'finished';
type PublicVote = { voterId: string; targetId: string; weight: number };
type ChatKind = 'chat' | 'speech' | 'system';
type ChatMessage = { id: string; playerId: string; name: string; text: string; at: number; kind: ChatKind };
type RoomState = {
  stage: Stage;
  hostId: string | null;
  players: PublicPlayer[];
  round: number;
  day: number;
  configuredRoles: Role[];
  rules: RuleSettings;
  dealtPlayerIds: string[];
  deadPlayerIds: string[];
  deaths: DeathRecord[];
  sheriffId: string | null;
  sheriffCandidates: string[];
  voteCandidates: string[];
  submittedCount: number;
  requiredCount: number;
  lastVotes: PublicVote[];
  lastDeaths: string[];
  speakingOrder: string[];
  speakingIndex: number;
  currentSpeakerId: string | null;
  spokenPlayerIds: string[];
  chat: ChatMessage[];
  result: { winner: 'werewolves' | 'village' | 'lovers'; reason: string } | null;
  revealedRoles: Record<string, Role> | null;
  notice: string | null;
};
type Context = {
  state: RoomState; players: Player[]; host: Player; random(): number;
  send(playerId: string, event: string, payload?: unknown): void;
  log(...args: unknown[]): void;
};

let cards: Record<string, PlayerCard> = {};
let lovers: string[] = [];
let submissions: Record<string, unknown> = {};
let guardedLastNight: string | null = null;
let guardedTonight: string | null = null;
let wolfTarget: string | null = null;
let witchSaved = false;
let witchPoisoned: string | null = null;
let antidoteAvailable = true;
let poisonAvailable = true;
let pendingDeaths: Array<{ playerId: string; cause: DeathCause }> = [];
let voteRoundCandidates: string[] = [];
let hunterShotUsed = false;
let wolfChat: ChatMessage[] = [];
let msgSeq = 0;

const ROLE_LABELS: Record<Role, string> = {
  werewolf: '狼人', villager: '村民', seer: '预言家', witch: '女巫', hunter: '猎人', guard: '守卫', cupid: '丘比特',
};
const NIGHT_STAGES = new Set<Stage>(['cupid', 'guard', 'werewolf', 'witch', 'seer']);
const CHAT_LIMIT = 100;
const TEXT_MAX = 200;

function isNightStage(stage: Stage) { return NIGHT_STAGES.has(stage); }
function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, TEXT_MAX) : null;
}
function nameOf(ctx: Context, playerId: string) { return ctx.state.players.find((player) => player.id === playerId)?.name ?? '玩家'; }
function pushPublicChat(ctx: Context, playerId: string, text: string, kind: ChatKind = 'chat') {
  ctx.state.chat.push({ id: `m${(msgSeq += 1)}`, playerId, name: kind === 'system' ? '系统' : nameOf(ctx, playerId), text, at: Date.now(), kind });
  if (ctx.state.chat.length > CHAT_LIMIT) ctx.state.chat.splice(0, ctx.state.chat.length - CHAT_LIMIT);
}
function pushSystem(ctx: Context, text: string) { pushPublicChat(ctx, '', text, 'system'); }
function pushWolfChat(ctx: Context, playerId: string, text: string) {
  wolfChat.push({ id: `w${(msgSeq += 1)}`, playerId, name: nameOf(ctx, playerId), text, at: Date.now(), kind: 'chat' });
  if (wolfChat.length > CHAT_LIMIT) wolfChat.splice(0, wolfChat.length - CHAT_LIMIT);
  for (const id of Object.keys(cards)) if (cards[id].role === 'werewolf') ctx.send(id, 'werewolf:wolf-chat', { messages: wolfChat });
}
function beginDay(ctx: Context) {
  const order = daySpeechOrder(ctx.state.dealtPlayerIds, ctx.state.deadPlayerIds, ctx.state.sheriffId);
  ctx.state.speakingOrder = order;
  ctx.state.speakingIndex = 0;
  ctx.state.currentSpeakerId = order[0] ?? null;
  ctx.state.spokenPlayerIds = [];
  if (!order.length) { startDayVote(ctx); return; }
  setStage(ctx, 'day-speech');
  pushSystem(ctx, `天亮了，白天发言开始，由 ${nameOf(ctx, order[0]!)} 起始。`);
}
function advanceDaySpeaker(ctx: Context) {
  const dead = new Set(ctx.state.deadPlayerIds);
  let index = ctx.state.speakingIndex + 1;
  while (index < ctx.state.speakingOrder.length && dead.has(ctx.state.speakingOrder[index]!)) index += 1;
  ctx.state.speakingIndex = index;
  if (index < ctx.state.speakingOrder.length) ctx.state.currentSpeakerId = ctx.state.speakingOrder[index]!;
  else startDayVote(ctx);
}
function startDayVote(ctx: Context) {
  ctx.state.currentSpeakerId = null;
  setStage(ctx, 'day-vote');
  ctx.state.voteCandidates = aliveIds(ctx);
  voteRoundCandidates = [...ctx.state.voteCandidates];
  pushSystem(ctx, '发言结束，进入放逐投票。');
}

function syncPlayers(ctx: Context) {
  ctx.state.hostId = ctx.host?.id ?? null;
  ctx.state.players = ctx.players.filter((p) => p.role !== 'spectator').map(({ id, name, role }) => ({ id, name, role: role === 'host' ? 'host' : 'player' }));
}
function aliveIds(ctx: Context) { const dead = new Set(ctx.state.deadPlayerIds); return ctx.state.dealtPlayerIds.filter((id) => !dead.has(id)); }
function requiredIds(ctx: Context): string[] {
  if (ctx.state.stage === 'role-check' || ctx.state.stage === 'hunter') return [...ctx.state.dealtPlayerIds];
  if (ctx.state.stage === 'sheriff-vote') return aliveIds(ctx).filter((id) => !ctx.state.sheriffCandidates.includes(id));
  return aliveIds(ctx);
}
function resetSubmissions(ctx: Context) {
  submissions = {};
  ctx.state.submittedCount = 0;
  ctx.state.requiredCount = requiredIds(ctx).length;
}
function setStage(ctx: Context, stage: Stage) { ctx.state.stage = stage; resetSubmissions(ctx); }
function roleId(role: Role) { return Object.keys(cards).find((id) => cards[id].role === role) ?? null; }
function sendSecrets(ctx: Context, id: string) {
  const card = cards[id]; if (!card) return;
  ctx.send(id, 'werewolf:role', privateRolePayload(card, ctx.state.round));
  if (card.role === 'werewolf') { ctx.send(id, 'werewolf:pack', { round: ctx.state.round, playerIds: Object.keys(cards).filter((pid) => cards[pid].role === 'werewolf') }); ctx.send(id, 'werewolf:wolf-chat', { messages: wolfChat }); }
  if (lovers.includes(id)) ctx.send(id, 'werewolf:lover', { round: ctx.state.round, playerId: lovers.find((pid) => pid !== id) });
}
function finishIfWon(ctx: Context): boolean {
  const result = resolveWinner(cards, ctx.state.deadPlayerIds, lovers, ctx.state.rules);
  if (!result) return false;
  ctx.state.result = result;
  ctx.state.revealedRoles = Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, card.role]));
  setStage(ctx, 'finished');
  return true;
}
function applyDeaths(ctx: Context, deaths: Array<{ playerId: string; cause: DeathCause }>) {
  const before = new Set(ctx.state.deaths.map(({ playerId }) => playerId));
  ctx.state.deaths = addDeathsWithHeartbreak(ctx.state.deaths, deaths, lovers, ctx.state.day);
  ctx.state.deadPlayerIds = ctx.state.deaths.map(({ playerId }) => playerId);
  ctx.state.lastDeaths = ctx.state.deadPlayerIds.filter((id) => !before.has(id));
}
function beginNight(ctx: Context) {
  ctx.state.day += 1;
  ctx.state.lastVotes = [];
  ctx.state.lastDeaths = [];
  ctx.state.voteCandidates = [];
  voteRoundCandidates = [];
  guardedTonight = null; wolfTarget = null; witchSaved = false; witchPoisoned = null; pendingDeaths = [];
  setStage(ctx, ctx.state.day === 1 && roleId('cupid') ? 'cupid' : roleId('guard') ? 'guard' : 'werewolf');
}
function afterDawn(ctx: Context) {
  applyDeaths(ctx, pendingDeaths);
  if (finishIfWon(ctx)) return;
  const hunter = roleId('hunter');
  const hunterDeath = hunter ? ctx.state.deaths.find(({ playerId }) => playerId === hunter) : null;
  const canShoot = hunterDeath && (hunterDeath.cause !== 'poison' || ctx.state.rules.poisonedHunterShoots);
  if (canShoot && !hunterShotUsed) { setStage(ctx, 'hunter'); return; }
  if (ctx.state.sheriffId && ctx.state.deadPlayerIds.includes(ctx.state.sheriffId)) { setStage(ctx, 'badge-transfer'); return; }
  beginDay(ctx);
}

function advance(ctx: Context) {
  const stage = ctx.state.stage;
  const values = Object.entries(submissions);
  if (stage === 'role-check') { beginNight(ctx); return; }
  if (stage === 'cupid') {
    const cupid = roleId('cupid'); const choice = cupid ? submissions[cupid] as { targets?: unknown } : null;
    if (Array.isArray(choice?.targets) && choice.targets.length === 2 && choice.targets[0] !== choice.targets[1] && choice.targets.every((id) => aliveIds(ctx).includes(id))) lovers = [...choice.targets] as string[];
    for (const id of lovers) sendSecrets(ctx, id);
    setStage(ctx, roleId('guard') ? 'guard' : 'werewolf'); return;
  }
  if (stage === 'guard') {
    const guard = roleId('guard'); const target = guard ? (submissions[guard] as { targetId?: unknown })?.targetId : null;
    if (typeof target === 'string' && aliveIds(ctx).includes(target) && (ctx.state.rules.allowConsecutiveGuard || target !== guardedLastNight)) guardedTonight = target;
    setStage(ctx, 'werewolf'); return;
  }
  if (stage === 'werewolf') {
    const wolfVotes = Object.fromEntries(values.filter(([id, value]) => cards[id]?.role === 'werewolf').map(([id, value]) => [id, (value as { targetId: string }).targetId]).filter(([, target]) => typeof target === 'string' && aliveIds(ctx).includes(target) && cards[target].role !== 'werewolf'));
    const leaders = voteLeaders(tallyVotes(wolfVotes));
    if (leaders.length > 1) { ctx.state.voteCandidates = leaders; voteRoundCandidates = leaders; resetSubmissions(ctx); return; }
    wolfTarget = leaders[0] ?? null;
    const witch = roleId('witch'); if (witch && !ctx.state.deadPlayerIds.includes(witch)) ctx.send(witch, 'werewolf:witch-night', { round: ctx.state.round, night: ctx.state.day, killedPlayerId: wolfTarget, antidoteAvailable, poisonAvailable });
    setStage(ctx, roleId('witch') ? 'witch' : roleId('seer') ? 'seer' : ctx.state.day === 1 ? 'sheriff-signup' : 'dawn');
    if (ctx.state.stage === 'dawn') { pendingDeaths = resolveNightDeaths({ killedId: wolfTarget, guardedId: guardedTonight, saved: false, poisonedId: null, guardSaveSurvives: ctx.state.rules.guardSaveSurvives }); guardedLastNight = guardedTonight; afterDawn(ctx); }
    return;
  }
  if (stage === 'witch') {
    const witch = roleId('witch'); const choice = witch ? submissions[witch] as { save?: unknown; poisonTargetId?: unknown } : null;
    const maySelfSave = wolfTarget !== witch || canWitchSelfSave(ctx.state.rules.selfSave, ctx.state.day);
    witchSaved = Boolean(choice?.save && antidoteAvailable && wolfTarget && maySelfSave);
    const poisonTarget = typeof choice?.poisonTargetId === 'string' && aliveIds(ctx).includes(choice.poisonTargetId) ? choice.poisonTargetId : null;
    witchPoisoned = poisonAvailable && (!witchSaved || ctx.state.rules.allowDoublePotion) ? poisonTarget : null;
    if (witchSaved) antidoteAvailable = false; if (witchPoisoned) poisonAvailable = false;
    setStage(ctx, roleId('seer') ? 'seer' : ctx.state.day === 1 ? 'sheriff-signup' : 'dawn');
    if (ctx.state.stage === 'dawn') { pendingDeaths = resolveNightDeaths({ killedId: wolfTarget, guardedId: guardedTonight, saved: witchSaved, poisonedId: witchPoisoned, guardSaveSurvives: ctx.state.rules.guardSaveSurvives }); guardedLastNight = guardedTonight; afterDawn(ctx); }
    return;
  }
  if (stage === 'seer') {
    const seer = roleId('seer'); const target = seer ? (submissions[seer] as { targetId?: unknown })?.targetId : null;
    if (seer && typeof target === 'string' && cards[target]) ctx.send(seer, 'werewolf:seer-result', { round: ctx.state.round, night: ctx.state.day, playerId: target, alignment: cards[target].role === 'werewolf' ? 'werewolf' : 'good' });
    pendingDeaths = resolveNightDeaths({ killedId: wolfTarget, guardedId: guardedTonight, saved: witchSaved, poisonedId: witchPoisoned, guardSaveSurvives: ctx.state.rules.guardSaveSurvives }); guardedLastNight = guardedTonight;
    if (ctx.state.day === 1) setStage(ctx, 'sheriff-signup'); else afterDawn(ctx);
    return;
  }
  if (stage === 'sheriff-signup') {
    ctx.state.sheriffCandidates = values.filter(([, v]) => Boolean((v as { join?: unknown }).join)).map(([id]) => id);
    if (!ctx.state.sheriffCandidates.length) { setStage(ctx, 'dawn'); afterDawn(ctx); return; }
    setStage(ctx, 'sheriff-withdraw'); return;
  }
  if (stage === 'sheriff-withdraw') {
    ctx.state.sheriffCandidates = ctx.state.sheriffCandidates.filter((id) => !Boolean((submissions[id] as { withdraw?: unknown })?.withdraw));
    if (ctx.state.sheriffCandidates.length === 1) { ctx.state.sheriffId = ctx.state.sheriffCandidates[0]; setStage(ctx, 'dawn'); afterDawn(ctx); return; }
    if (!ctx.state.sheriffCandidates.length) { setStage(ctx, 'dawn'); afterDawn(ctx); return; }
    setStage(ctx, 'sheriff-vote'); ctx.state.voteCandidates = [...ctx.state.sheriffCandidates]; voteRoundCandidates = [...ctx.state.sheriffCandidates];
    if (!ctx.state.requiredCount) { ctx.state.sheriffId = null; setStage(ctx, 'dawn'); afterDawn(ctx); }
    return;
  }
  if (stage === 'sheriff-vote' || stage === 'day-vote') {
    const candidates = voteRoundCandidates.length ? voteRoundCandidates : ctx.state.voteCandidates;
    const votes = Object.fromEntries(values.map(([id, value]) => [id, (value as { targetId?: unknown }).targetId]).filter(([, target]) => typeof target === 'string' && candidates.includes(target)) as Array<[string, string]>);
    const weights = stage === 'day-vote' && ctx.state.sheriffId ? { [ctx.state.sheriffId]: 1.5 } : {};
    const leaders = voteLeaders(tallyVotes(votes, weights));
    ctx.state.lastVotes = Object.entries(votes).map(([voterId, targetId]) => ({ voterId, targetId, weight: weights[voterId] ?? 1 }));
    if (leaders.length > 1) { voteRoundCandidates = leaders; ctx.state.voteCandidates = leaders; resetSubmissions(ctx); return; }
    if (stage === 'sheriff-vote') { ctx.state.sheriffId = leaders[0] ?? null; setStage(ctx, 'dawn'); afterDawn(ctx); return; }
    if (leaders[0]) applyDeaths(ctx, [{ playerId: leaders[0], cause: 'exile' }]);
    if (finishIfWon(ctx)) return;
    const hunter = roleId('hunter'); const death = hunter ? ctx.state.deaths.find(({ playerId }) => playerId === hunter) : null;
    if (death && !hunterShotUsed && (death.cause !== 'poison' || ctx.state.rules.poisonedHunterShoots)) { setStage(ctx, 'hunter'); return; }
    if (ctx.state.sheriffId && ctx.state.deadPlayerIds.includes(ctx.state.sheriffId)) { setStage(ctx, 'badge-transfer'); return; }
    beginNight(ctx); return;
  }
  if (stage === 'hunter') {
    const hunter = roleId('hunter'); const choice = hunter ? submissions[hunter] as { targetId?: unknown } : null;
    if (hunter) hunterShotUsed = true;
    if (typeof choice?.targetId === 'string' && aliveIds(ctx).includes(choice.targetId)) applyDeaths(ctx, [{ playerId: choice.targetId, cause: 'hunter-shot' }]);
    if (finishIfWon(ctx)) return;
    if (ctx.state.sheriffId && ctx.state.deadPlayerIds.includes(ctx.state.sheriffId)) setStage(ctx, 'badge-transfer');
    else if (ctx.state.lastVotes.length) beginNight(ctx); else beginDay(ctx);
    return;
  }
  if (stage === 'badge-transfer') return;
}

export default defineRoom({
  meta: { name: '狼人杀 · 月夜审判', minPlayers: 6, maxPlayers: 12 },
  initialState(): RoomState { return { stage: 'waiting', hostId: null, players: [], round: 0, day: 0, configuredRoles: [...RECOMMENDED_DECKS[6]], rules: { ...DEFAULT_RULES }, dealtPlayerIds: [], deadPlayerIds: [], deaths: [], sheriffId: null, sheriffCandidates: [], voteCandidates: [], submittedCount: 0, requiredCount: 0, lastVotes: [], lastDeaths: [], speakingOrder: [], speakingIndex: 0, currentSpeakerId: null, spokenPlayerIds: [], chat: [], result: null, revealedRoles: null, notice: null }; },
  onJoin(ctx: Context) { syncPlayers(ctx); if (ctx.state.stage === 'waiting') ctx.state.configuredRoles = [...(RECOMMENDED_DECKS[ctx.state.players.length] ?? ctx.state.configuredRoles)]; },
  onLeave(ctx: Context, player: Player) { ctx.state.players = ctx.state.players.filter(({ id }) => id !== player.id); ctx.state.notice = ctx.state.stage === 'waiting' ? null : '有玩家离线，牌局将等待其重连'; },
  onReconnect(ctx: Context, player: Player) { syncPlayers(ctx); sendSecrets(ctx, player.id); ctx.state.notice = null; },
  onRestore(ctx: Context) { cards = {}; lovers = []; submissions = {}; wolfChat = []; ctx.state.stage = 'waiting'; ctx.state.dealtPlayerIds = []; ctx.state.deadPlayerIds = []; ctx.state.deaths = []; ctx.state.speakingOrder = []; ctx.state.speakingIndex = 0; ctx.state.currentSpeakerId = null; ctx.state.spokenPlayerIds = []; ctx.state.chat = []; ctx.state.result = null; ctx.state.revealedRoles = null; ctx.state.notice = '房间已恢复，秘密状态无法恢复，请重新发牌'; syncPlayers(ctx); },
  actions: {
    'settings:setDeck'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (event.player.id !== ctx.host.id || ctx.state.stage !== 'waiting') return;
      const roles = (event.payload as { roles?: unknown })?.roles;
      if (!Array.isArray(roles)) return;
      const error = validateDeck(roles as Role[], ctx.state.players.length); if (error) { ctx.state.notice = error; return; }
      ctx.state.configuredRoles = [...roles] as Role[]; ctx.state.notice = null;
    },
    'settings:setRules'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (event.player.id !== ctx.host.id || ctx.state.stage !== 'waiting') return;
      ctx.state.rules = { ...ctx.state.rules, ...(event.payload as Partial<RuleSettings>) };
    },
    'game:start'(ctx: Context, event: { player: Player }) {
      if (event.player.id !== ctx.host.id) return;
      syncPlayers(ctx); const ids = ctx.state.players.map(({ id }) => id); const error = validateDeck(ctx.state.configuredRoles, ids.length);
      if (error) { ctx.state.notice = error; return; }
      cards = dealRoles(ids, ctx.state.configuredRoles, () => ctx.random()); lovers = []; guardedLastNight = null; antidoteAvailable = true; poisonAvailable = true; pendingDeaths = []; hunterShotUsed = false; wolfChat = [];
      ctx.state.round += 1; ctx.state.day = 0; ctx.state.dealtPlayerIds = ids; ctx.state.deadPlayerIds = []; ctx.state.deaths = []; ctx.state.sheriffId = null; ctx.state.sheriffCandidates = []; ctx.state.lastVotes = []; ctx.state.lastDeaths = []; ctx.state.speakingOrder = []; ctx.state.speakingIndex = 0; ctx.state.currentSpeakerId = null; ctx.state.spokenPlayerIds = []; ctx.state.chat = []; ctx.state.result = null; ctx.state.revealedRoles = null; ctx.state.notice = null;
      setStage(ctx, 'role-check'); for (const id of ids) sendSecrets(ctx, id); ctx.log('werewolf game started', ctx.state.round, ids.length);
    },
    'game:restart'(ctx: Context, event: { player: Player }) {
      if (event.player.id !== ctx.host.id) return;
      cards = {}; lovers = []; submissions = {}; wolfChat = []; ctx.state.stage = 'waiting'; ctx.state.dealtPlayerIds = []; ctx.state.deadPlayerIds = []; ctx.state.deaths = []; ctx.state.speakingOrder = []; ctx.state.speakingIndex = 0; ctx.state.currentSpeakerId = null; ctx.state.spokenPlayerIds = []; ctx.state.chat = []; ctx.state.result = null; ctx.state.revealedRoles = null; ctx.state.sheriffId = null; ctx.state.notice = '本局已结束，可重新配置并发牌';
    },
    'stage:submit'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (ctx.state.stage === 'waiting' || ctx.state.stage === 'finished' || ctx.state.stage === 'badge-transfer' || ctx.state.stage === 'day-speech') return;
      const required = requiredIds(ctx); if (!required.includes(event.player.id) || event.player.id in submissions) return;
      submissions[event.player.id] = event.payload ?? {}; ctx.state.submittedCount = Object.keys(submissions).filter((id) => required.includes(id)).length; ctx.state.requiredCount = required.length;
      if (ctx.state.stage === 'werewolf' && cards[event.player.id]?.role === 'werewolf') {
        const packIds = Object.keys(cards).filter((id) => cards[id].role === 'werewolf');
        const votes = packIds.flatMap((id) => {
          const targetId = (submissions[id] as { targetId?: unknown } | undefined)?.targetId;
          return typeof targetId === 'string' ? [{ voterId: id, targetId }] : [];
        });
        for (const id of packIds) ctx.send(id, 'werewolf:pack-votes', { round: ctx.state.round, night: ctx.state.day, votes });
      }
      if (ctx.state.submittedCount === ctx.state.requiredCount) advance(ctx);
    },
    'sheriff:badge'(ctx: Context, event: { player: Player; payload: unknown }) {
      if (ctx.state.stage !== 'badge-transfer' || event.player.id !== ctx.state.sheriffId) return;
      const targetId = (event.payload as { targetId?: unknown })?.targetId;
      ctx.state.sheriffId = typeof targetId === 'string' && aliveIds(ctx).includes(targetId) ? targetId : null;
      if (ctx.state.lastVotes.length) beginNight(ctx); else beginDay(ctx);
    },
    speak(ctx: Context, event: { player: Player; payload: unknown }) {
      if (ctx.state.stage !== 'day-speech' || ctx.state.currentSpeakerId !== event.player.id) return;
      const text = normalizeText((event.payload as { text?: unknown } | null)?.text);
      if (!text) return;
      pushPublicChat(ctx, event.player.id, text, 'speech');
      ctx.state.spokenPlayerIds.push(event.player.id);
      advanceDaySpeaker(ctx);
    },
    chat(ctx: Context, event: { player: Player; payload: unknown }) {
      if (!aliveIds(ctx).includes(event.player.id)) return;
      const text = normalizeText((event.payload as { text?: unknown } | null)?.text);
      if (!text) return;
      const channel = (event.payload as { channel?: unknown } | null)?.channel === 'wolf' ? 'wolf' : 'public';
      if (channel === 'wolf') {
        if (cards[event.player.id]?.role !== 'werewolf' || !isNightStage(ctx.state.stage)) return;
        pushWolfChat(ctx, event.player.id, text);
        return;
      }
      if (isNightStage(ctx.state.stage) || ctx.state.stage === 'waiting' || ctx.state.stage === 'finished') return;
      pushPublicChat(ctx, event.player.id, text, 'chat');
    },
  },
});
