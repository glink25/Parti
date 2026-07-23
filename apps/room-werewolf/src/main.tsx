import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_RULES, RECOMMENDED_DECKS, ROLES, addDeathsWithHeartbreak, dealRoles, resolveWinner,
  validateDeck, type DeathCause, type DeathRecord, type Role, type RuleSettings,
} from './game-logic';
import './styles.css';

declare const parti: {
  playerId: string | null; getState(): unknown; onState(handler: (state: unknown) => void): () => void;
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
  action(name: string, payload?: unknown): Promise<{ ok: true }>; ready(): void;
  exposeToAgent?(describe: (state: unknown) => unknown): void;
};

type Stage = 'waiting' | 'role-check' | 'cupid' | 'guard' | 'werewolf' | 'witch' | 'seer' | 'sheriff-signup' | 'sheriff-withdraw' | 'sheriff-vote' | 'dawn' | 'hunter' | 'badge-transfer' | 'day-speech' | 'day-vote' | 'finished';
type Player = { id: string; name: string; role: 'host' | 'player' };
type ChatMessage = { id: string; playerId: string; name: string; text: string; at: number; kind: 'chat' | 'speech' | 'system' };
type RoomState = {
  stage: Stage; hostId: string | null; players: Player[]; round: number; day: number; configuredRoles: Role[]; rules: RuleSettings;
  dealtPlayerIds: string[]; deadPlayerIds: string[]; deaths: DeathRecord[]; sheriffId: string | null; sheriffCandidates: string[];
  voteCandidates: string[]; submittedCount: number; requiredCount: number; lastVotes: Array<{ voterId: string; targetId: string; weight: number }>;
  lastDeaths: string[]; speakingOrder: string[]; speakingIndex: number; currentSpeakerId: string | null; spokenPlayerIds: string[]; chat: ChatMessage[];
  result: { winner: 'werewolves' | 'village' | 'lovers'; reason: string } | null;
  revealedRoles: Record<string, Role> | null; notice: string | null;
};
type PrivateRole = { round: number; role: Role };
type LocalCard = { id: string; role: Role; seen: boolean };

const ROLE_META: Record<Role, { name: string; icon: string; team: string; description: string }> = {
  werewolf: { name: '狼人', icon: '狼', team: '狼人阵营', description: '夜晚与狼队选择一名目标。' },
  villager: { name: '村民', icon: '民', team: '好人阵营', description: '依靠发言与投票找出狼人。' },
  seer: { name: '预言家', icon: '预', team: '神职', description: '每晚查验一名玩家的阵营。' },
  witch: { name: '女巫', icon: '巫', team: '神职', description: '拥有一瓶解药和一瓶毒药。' },
  hunter: { name: '猎人', icon: '猎', team: '神职', description: '死亡时可选择带走一名玩家。' },
  guard: { name: '守卫', icon: '守', team: '神职', description: '每晚守护一名玩家。' },
  cupid: { name: '丘比特', icon: '恋', team: '神职', description: '首夜连接两名玩家成为情侣。' },
};
const STAGE_COPY: Record<Stage, { title: string; note: string }> = {
  waiting: { title: '等待月夜降临', note: '房主在发牌台配置阵容与规则。' },
  'role-check': { title: '确认你的身份', note: '所有人确认后，第一夜才会开始。' },
  cupid: { title: '丘比特之夜', note: '请选择两名玩家。所有人的操作外观完全相同。' },
  guard: { title: '守卫行动', note: '选择一名守护目标。所有人的操作外观完全相同。' },
  werewolf: { title: '狼人行动', note: '选择一名袭击目标。只有真实狼人票会被采纳。' },
  witch: { title: '女巫行动', note: '选择是否用药。只有真实女巫操作有效。' },
  seer: { title: '预言家查验', note: '选择一名查验目标。只有真实预言家会获得结果。' },
  'sheriff-signup': { title: '竞选警长', note: '选择上警或不上警。' },
  'sheriff-withdraw': { title: '警上退水', note: '候选人可退水，其他人也需完成相同确认。' },
  'sheriff-vote': { title: '警长投票', note: '非候选人从候选人中投票，平票将持续重投。' },
  dawn: { title: '天亮了', note: '上帝正在结算昨夜事件。' },
  hunter: { title: '猎人抉择', note: '所有人都需选择目标或放弃，只有猎人的操作有效。' },
  'badge-transfer': { title: '警徽流转', note: '警长选择移交警徽或将其撕毁。' },
  'day-speech': { title: '白天发言', note: '存活玩家按顺序轮流发言，轮到你时在下方发言。' },
  'day-vote': { title: '白天放逐', note: '讨论结束后投票；警长票计 1.5 票。' },
  finished: { title: '审判结束', note: '所有身份已揭晓。' },
};

function playerName(state: RoomState | null, id: string | null | undefined) { return state?.players.find((p) => p.id === id)?.name ?? '未知玩家'; }

function DealTable({ count, roles, rules, onRoles, onRules, onDeal }: { count: number; roles: Role[]; rules: RuleSettings; onRoles(r: Role[]): void; onRules(r: RuleSettings): void; onDeal(): void }) {
  const error = validateDeck(roles, count);
  function setRole(role: Role, delta: number) {
    const next = [...roles];
    if (delta > 0) next.push(role); else { const index = next.lastIndexOf(role); if (index >= 0) next.splice(index, 1); }
    onRoles(next);
  }
  return <div className="deal-table">
    <div className="preset-row"><span>{count} 人阵容</span><button onClick={() => onRoles([...(RECOMMENDED_DECKS[count] ?? roles)])}>恢复推荐</button></div>
    <div className="role-config">{ROLES.map((role) => { const total = roles.filter((r) => r === role).length; const unique = !['werewolf', 'villager'].includes(role); return <div className="role-step" key={role}><span className="mini-role">{ROLE_META[role].icon}</span><div><strong>{ROLE_META[role].name}</strong><small>{ROLE_META[role].team}</small></div><button onClick={() => setRole(role, -1)} disabled={!total}>−</button><b>{total}</b><button onClick={() => setRole(role, 1)} disabled={unique ? total >= 1 : roles.length >= count}>＋</button></div>; })}</div>
    <h3>房规</h3>
    <div className="rules-grid">
      <label>情侣胜利<select value={rules.loverRule} onChange={(e) => onRules({ ...rules, loverRule: e.target.value as RuleSettings['loverRule'] })}><option value="all-third-party">所有情侣第三方</option><option value="mixed-third-party">仅人狼情侣第三方</option><option value="bond-only">只连死不改阵营</option></select></label>
      <label>女巫自救<select value={rules.selfSave} onChange={(e) => onRules({ ...rules, selfSave: e.target.value as RuleSettings['selfSave'] })}><option value="never">不能自救</option><option value="first-night">仅首夜可自救</option><option value="always">每夜可自救</option></select></label>
      {[['allowDoublePotion', '允许同夜双药'], ['allowConsecutiveGuard', '允许连续守同一人'], ['guardSaveSurvives', '同守同救仍存活'], ['poisonedHunterShoots', '猎人被毒仍可开枪']].map(([key, label]) => <label className="toggle" key={key}><input type="checkbox" checked={Boolean(rules[key as keyof RuleSettings])} onChange={(e) => onRules({ ...rules, [key]: e.target.checked })} /><span>{label}</span></label>)}
    </div>
    {error && <p className="notice">{error}</p>}
    <button className="primary" disabled={Boolean(error)} onClick={onDeal}>洗牌并发牌</button>
  </div>;
}

function StageAction({ state, submitted, role, playerId, witchInfo, onSubmit, onBadge }: { state: RoomState; submitted: boolean; role: Role | null; playerId: string | null; witchInfo: { killedPlayerId: string | null } | null; onSubmit(payload: unknown): void; onBadge(targetId: string | null): void }) {
  const [target, setTarget] = useState(''); const [second, setSecond] = useState(''); const [save, setSave] = useState(false); const [poison, setPoison] = useState('');
  useEffect(() => { setTarget(''); setSecond(''); setSave(false); setPoison(''); }, [state.stage, state.day]);
  const alive = state.players.filter((p) => state.dealtPlayerIds.includes(p.id) && !state.deadPlayerIds.includes(p.id));
  const candidateIds = state.voteCandidates.length && ['werewolf', 'sheriff-vote', 'day-vote'].includes(state.stage) ? state.voteCandidates : alive.map((p) => p.id);
  if (submitted) return <div className="submitted"><span>✓</span><h3>操作已密封</h3><p>等待其他玩家完成 · {state.submittedCount}/{state.requiredCount}</p></div>;
  if (state.stage === 'role-check') return <button className="primary" onClick={() => onSubmit({ ready: true })}>我已确认身份</button>;
  if (state.stage === 'sheriff-signup') return <div className="choice-row"><button onClick={() => onSubmit({ join: false })}>不上警</button><button className="primary" onClick={() => onSubmit({ join: true })}>竞选警长</button></div>;
  if (state.stage === 'sheriff-withdraw') return <div className="choice-row"><button onClick={() => onSubmit({ withdraw: false })}>继续确认</button><button className="danger" onClick={() => onSubmit({ withdraw: true })}>选择退水</button></div>;
  if (state.stage === 'witch') return <div className="action-form"><div className="night-hint">今夜目标：{role === 'witch' && witchInfo?.killedPlayerId ? playerName(state, witchInfo.killedPlayerId) : '密封信息'}</div><label className="toggle"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /><span>使用解药</span></label><label>毒药目标<select value={poison} onChange={(e) => setPoison(e.target.value)}><option value="">不使用毒药</option>{alive.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="primary" onClick={() => onSubmit({ save, poisonTargetId: poison || null })}>密封提交</button></div>;
  if (state.stage === 'cupid') return <div className="action-form"><label>第一位<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">请选择</option>{alive.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>第二位<select value={second} onChange={(e) => setSecond(e.target.value)}><option value="">请选择</option>{alive.filter((p) => p.id !== target).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="primary" disabled={!target || !second} onClick={() => onSubmit({ targets: [target, second] })}>密封提交</button></div>;
  if (state.stage === 'hunter') return <div className="action-form"><label>带走目标<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">放弃开枪</option>{alive.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="primary" onClick={() => onSubmit({ targetId: target || null })}>密封提交</button></div>;
  if (state.stage === 'badge-transfer') return playerId === state.sheriffId ? <div className="action-form"><label>警徽去向<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">撕毁警徽</option>{alive.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="primary" onClick={() => onBadge(target || null)}>确认警徽去向</button></div> : <div className="submitted"><p>等待警长处理警徽</p></div>;
  if (['guard', 'werewolf', 'seer', 'sheriff-vote', 'day-vote'].includes(state.stage)) return <div className="action-form"><label>选择目标<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">请选择</option>{alive.filter((p) => candidateIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="primary" disabled={!target} onClick={() => onSubmit({ targetId: target })}>密封提交</button></div>;
  return <div className="submitted"><div className="moon-loader" /><p>上帝正在结算……</p></div>;
}

// AI agent 转述：运行在本玩家视角 UI 内，只读本玩家可见信息（身份、情侣、狼队、狼人频道来自私密事件）。
// 内容与逻辑迁移自旧 worker 侧 describe()/werewolfObserve()，改为读客户端本地状态。
const WEREWOLF_GUIDE = {
  summary: '狼人杀·月夜审判：狼人夜里袭击，预言家/女巫/猎人/守卫/丘比特等神职与村民白天发言、投票放逐可疑者。',
  objective: '好人阵营（村民+神职）投出所有狼人即胜；狼人杀光村民或神职即胜；情侣按房规可能成为第三方。夜间行动、白天发言与投票都在房间内进行，AI 通过聊天室获取讨论上下文。',
  actions: [
    { name: 'stage:submit', description: '当前阶段的密封提交：夜间行动、警长竞选/退水、警长投票、白天放逐投票、猎人开枪都用它。payload 依阶段而定（见 availableActions）。夜间每个存活玩家都需提交以推进，非行动身份可提交空对象保持匿名。', payloadSchema: { type: 'object' } },
    { name: 'speak', description: '白天发言阶段轮到你时发表一条发言（进入公共聊天）。', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] } },
    { name: 'chat', description: '聊天：白天存活玩家公共聊天；夜晚狼人可用 channel="wolf" 在狼人频道交流。', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 }, channel: { enum: ['public', 'wolf'] } }, required: ['text'] } },
    { name: 'sheriff:badge', description: '（警长）警徽流转阶段移交或撕毁警徽。', payloadSchema: { type: 'object', properties: { targetId: { type: 'string' } } } },
    { name: 'game:start', description: '（房主）发牌开始。', payloadSchema: { type: 'null' } },
    { name: 'game:restart', description: '（房主）结束本局回到配置。', payloadSchema: { type: 'null' } },
  ],
  glossary: {
    stage: 'waiting/role-check/cupid/guard/werewolf/witch/seer/sheriff-signup/sheriff-withdraw/sheriff-vote/dawn/day-speech/day-vote/hunter/badge-transfer/finished',
    round: '第几局。', day: '第几个夜晚/白天。',
    dealtPlayerIds: '本局参与者 id。', deadPlayerIds: '已死亡玩家 id。',
    sheriffId: '当前警长 id。', voteCandidates: '当前可投候选 id。',
    currentSpeakerId: '白天发言阶段当前发言者 id。', chat: '公共聊天与发言记录（kind: speech/chat/system）。',
    submittedCount: '本阶段已提交人数。', requiredCount: '本阶段需提交人数。',
  },
} as const;

type WerewolfAgentCtx = { state: RoomState | null; role: Role | null; pack: string[]; lover: string | null; wolfChat: ChatMessage[]; witchInfo: { killedPlayerId: string | null } | null; submitted: boolean };
const NIGHT_STAGE_SET = new Set<Stage>(['cupid', 'guard', 'werewolf', 'witch', 'seer']);
function wwAlive(state: RoomState): string[] { const dead = new Set(state.deadPlayerIds); return state.dealtPlayerIds.filter((id) => !dead.has(id)); }
function wwName(state: RoomState, id: string): string { return state.players.find((p) => p.id === id)?.name ?? '玩家'; }
function wwChatDigest(state: RoomState, limit = 12): string[] { return state.chat.slice(-limit).map((m) => m.kind === 'system' ? `[系统] ${m.text}` : `${m.name}${m.kind === 'speech' ? '(发言)' : ''}: ${m.text}`); }
function wwEnumSchema(ids: string[]) { return { type: 'object', properties: { targetId: { enum: ids } }, required: ['targetId'] }; }

function buildWerewolfGuide(actx: WerewolfAgentCtx, playerId: string | null) {
  const g = WEREWOLF_GUIDE;
  const state = actx.state;
  if (!state || !playerId) return { ...g, phase: 'connecting', narrative: '正在连接房间…', isYourTurn: false, availableActions: [] };
  const stage = state.stage;
  const role = actx.role;
  const inGame = state.dealtPlayerIds.includes(playerId);
  const dead = state.deadPlayerIds.includes(playerId);
  const alive = wwAlive(state);
  const recent = wwChatDigest(state);
  const chatAction = { name: 'chat', hint: '公共聊天', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] } };
  const wolfChatAction = { name: 'chat', hint: '狼人频道发言（channel=wolf）', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 }, channel: { enum: ['wolf'] } }, required: ['text', 'channel'] } };
  const submitted = actx.submitted;
  const roleLine = role ? `你的身份是「${ROLE_META[role].name}」。` : '';
  const loverLine = actx.lover ? `你的情侣是 ${wwName(state, actx.lover)}。` : '';
  const base = `${roleLine}${loverLine} 第 ${state.day} 天（${stage}）。存活：${alive.map((id) => wwName(state, id)).join('、')}。`;

  if (stage === 'waiting') {
    const isHost = state.hostId === playerId;
    return { ...g, phase: 'waiting', narrative: `${base} 等待房主发牌。`, isYourTurn: false, availableActions: isHost ? [{ name: 'game:start', hint: '发牌开始（阵容合法时）' }] : [], recentEvents: recent, waitingFor: '等待房主发牌' };
  }
  if (stage === 'finished') {
    const label = state.result?.winner === 'village' ? '好人胜利' : state.result?.winner === 'werewolves' ? '狼人胜利' : state.result?.winner === 'lovers' ? '情侣胜利' : '结束';
    return { ...g, phase: 'finished', narrative: `${base} ${label}。${state.result?.reason ?? ''}`, isYourTurn: false, availableActions: [], recentEvents: recent };
  }
  if (!inGame) {
    return { ...g, phase: stage, narrative: `${base} 你未参与本局，正在旁观。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: '旁观中' };
  }
  if (stage === 'hunter') {
    if (submitted) return { ...g, phase: stage, narrative: `${base} 等待其他玩家提交。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: `等待提交 ${state.submittedCount}/${state.requiredCount}` };
    if (role === 'hunter') return { ...g, phase: stage, narrative: `${base} 你（猎人）死亡，可开枪带走一人或放弃。`, isYourTurn: true, availableActions: [{ name: 'stage:submit', hint: '开枪目标 id，或 targetId=null 放弃', payloadSchema: { type: 'object', properties: { targetId: { enum: [...alive, null] } } } }], recentEvents: recent };
    return { ...g, phase: stage, narrative: `${base} 猎人抉择中，请提交以继续（你无需行动）。`, isYourTurn: true, availableActions: [{ name: 'stage:submit', hint: '提交空对象保持匿名', payloadSchema: { type: 'object' } }], recentEvents: recent };
  }
  if (dead) {
    return { ...g, phase: stage, narrative: `${base} 你已死亡，只能旁观公共聊天。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: '旁观中' };
  }
  if (stage === 'role-check') {
    if (submitted) return { ...g, phase: stage, narrative: `${base} 已确认，等待其他玩家。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: `等待确认 ${state.submittedCount}/${state.requiredCount}` };
    return { ...g, phase: stage, narrative: `${base} 请确认身份。`, isYourTurn: true, availableActions: [{ name: 'stage:submit', hint: '确认身份', payloadSchema: { type: 'object', properties: { ready: { const: true } }, required: ['ready'] }, examples: [{ ready: true }] }], recentEvents: recent };
  }
  if (NIGHT_STAGE_SET.has(stage)) {
    const nightActions: Array<Record<string, unknown>> = [];
    if (submitted) {
      const acts = role === 'werewolf' ? [wolfChatAction] : [];
      return { ...g, phase: stage, narrative: `${base} 已提交，等待其他玩家。`, isYourTurn: false, availableActions: acts, recentEvents: recent, waitingFor: `等待夜间行动 ${state.submittedCount}/${state.requiredCount}` };
    }
    if (stage === 'cupid' && role === 'cupid') nightActions.push({ name: 'stage:submit', hint: '连接两名玩家为情侣', payloadSchema: { type: 'object', properties: { targets: { type: 'array', items: { enum: alive }, minItems: 2, maxItems: 2 } }, required: ['targets'] } });
    else if (stage === 'guard' && role === 'guard') nightActions.push({ name: 'stage:submit', hint: '守护一名玩家', payloadSchema: wwEnumSchema(alive) });
    else if (stage === 'werewolf' && role === 'werewolf') { nightActions.push({ name: 'stage:submit', hint: '选择袭击目标（非狼人）', payloadSchema: wwEnumSchema(alive.filter((id) => !actx.pack.includes(id))) }); nightActions.push(wolfChatAction); }
    else if (stage === 'witch' && role === 'witch') nightActions.push({ name: 'stage:submit', hint: `${actx.witchInfo?.killedPlayerId ? `今夜被袭击的是 ${wwName(state, actx.witchInfo.killedPlayerId)}。` : ''}使用解药 save 和/或毒药 poisonTargetId`, payloadSchema: { type: 'object', properties: { save: { type: 'boolean' }, poisonTargetId: { enum: [...alive, null] } } } });
    else if (stage === 'seer' && role === 'seer') nightActions.push({ name: 'stage:submit', hint: '查验一名玩家的阵营', payloadSchema: wwEnumSchema(alive) });
    else { nightActions.push({ name: 'stage:submit', hint: '此阶段你的身份无需行动，提交空对象保持匿名', payloadSchema: { type: 'object' } }); if (role === 'werewolf') nightActions.push(wolfChatAction); }
    const wolfNote = role === 'werewolf' ? ` 狼队：${actx.pack.map((id) => wwName(state, id)).join('、')}。狼人频道：${actx.wolfChat.slice(-8).map((m) => `${m.name}:${m.text}`).join(' / ') || '（空）'}` : '';
    return { ...g, phase: stage, narrative: `${base}${wolfNote}`, isYourTurn: true, availableActions: nightActions, recentEvents: recent };
  }
  if (stage === 'sheriff-signup') {
    if (submitted) return { ...g, phase: stage, narrative: `${base} 已提交。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: `等待 ${state.submittedCount}/${state.requiredCount}` };
    return { ...g, phase: stage, narrative: `${base} 是否竞选警长？`, isYourTurn: true, availableActions: [{ name: 'stage:submit', hint: 'join=true 竞选，false 不上警', payloadSchema: { type: 'object', properties: { join: { type: 'boolean' } }, required: ['join'] } }], recentEvents: recent };
  }
  if (stage === 'sheriff-withdraw') {
    if (submitted) return { ...g, phase: stage, narrative: `${base} 已提交。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: `等待 ${state.submittedCount}/${state.requiredCount}` };
    const isCandidate = state.sheriffCandidates.includes(playerId);
    return { ...g, phase: stage, narrative: `${base} ${isCandidate ? '你是候选人，是否退水？' : '请提交以继续。'}`, isYourTurn: true, availableActions: [{ name: 'stage:submit', hint: isCandidate ? 'withdraw=true 退水' : '提交空对象继续', payloadSchema: { type: 'object', properties: { withdraw: { type: 'boolean' } } } }], recentEvents: recent };
  }
  if (stage === 'sheriff-vote') {
    if (state.sheriffCandidates.includes(playerId)) return { ...g, phase: stage, narrative: `${base} 你是候选人，等待其他人投票。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: '等待警长投票' };
    if (submitted) return { ...g, phase: stage, narrative: `${base} 已投票。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: `等待 ${state.submittedCount}/${state.requiredCount}` };
    return { ...g, phase: stage, narrative: `${base} 从候选人中投出警长。`, isYourTurn: true, availableActions: [{ name: 'stage:submit', hint: '投票警长', payloadSchema: wwEnumSchema(state.voteCandidates) }], recentEvents: recent };
  }
  if (stage === 'day-speech') {
    if (state.currentSpeakerId === playerId) return { ...g, phase: stage, narrative: `${base} 轮到你发言。`, isYourTurn: true, availableActions: [{ name: 'speak', hint: '发表你的白天发言', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] } }, chatAction], recentEvents: recent };
    const speaker = state.currentSpeakerId ? wwName(state, state.currentSpeakerId) : '其他玩家';
    return { ...g, phase: stage, narrative: `${base} 轮到 ${speaker} 发言。`, isYourTurn: false, availableActions: [chatAction], recentEvents: recent, waitingFor: `等待 ${speaker} 发言` };
  }
  if (stage === 'day-vote') {
    if (submitted) return { ...g, phase: stage, narrative: `${base} 已投票，等待其他玩家。`, isYourTurn: false, availableActions: [chatAction], recentEvents: recent, waitingFor: `等待放逐投票 ${state.submittedCount}/${state.requiredCount}` };
    return { ...g, phase: stage, narrative: `${base} 投出你要放逐的玩家。`, isYourTurn: true, availableActions: [{ name: 'stage:submit', hint: '放逐投票', payloadSchema: wwEnumSchema(state.voteCandidates) }, chatAction], recentEvents: recent };
  }
  if (stage === 'badge-transfer') {
    if (state.sheriffId === playerId) return { ...g, phase: stage, narrative: `${base} 你是警长，移交或撕毁警徽。`, isYourTurn: true, availableActions: [{ name: 'sheriff:badge', hint: '移交给某人，或 targetId=null 撕毁', payloadSchema: { type: 'object', properties: { targetId: { enum: [...alive.filter((id) => id !== playerId), null] } } } }], recentEvents: recent };
    return { ...g, phase: stage, narrative: `${base} 等待警长处理警徽。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: '等待警徽流转' };
  }
  return { ...g, phase: stage, narrative: `${base} 上帝正在结算。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: '请稍候' };
}

function App() {
  const [mode, setMode] = useState<'online' | 'box'>('online'); const [state, setState] = useState<RoomState | null>(null); const [playerId, setPlayerId] = useState<string | null>(null);
  const [privateRole, setPrivateRole] = useState<PrivateRole | null>(null); const [pack, setPack] = useState<string[]>([]); const [lover, setLover] = useState<string | null>(null); const [seerResult, setSeerResult] = useState<string | null>(null); const [witchInfo, setWitchInfo] = useState<{ killedPlayerId: string | null } | null>(null);
  const [packVotes, setPackVotes] = useState<Array<{ voterId: string; targetId: string }>>([]);
  const [wolfChat, setWolfChat] = useState<ChatMessage[]>([]); const [speakText, setSpeakText] = useState(''); const [chatText, setChatText] = useState('');
  const agentRef = useRef<WerewolfAgentCtx>({ state: null, role: null, pack: [], lover: null, wolfChat: [], witchInfo: null, submitted: false });
  const [roleOpen, setRoleOpen] = useState(false); const [dealOpen, setDealOpen] = useState(false); const [submittedKey, setSubmittedKey] = useState('');
  const [boxCount, setBoxCount] = useState(8); const [boxRoles, setBoxRoles] = useState<Role[]>([...RECOMMENDED_DECKS[8]]); const [boxRules, setBoxRules] = useState<RuleSettings>({ ...DEFAULT_RULES }); const [boxCards, setBoxCards] = useState<LocalCard[]>([]); const [boxOpen, setBoxOpen] = useState<string | null>(null); const [boxDeaths, setBoxDeaths] = useState<DeathRecord[]>([]); const [boxLovers, setBoxLovers] = useState<string[]>([]);
  useEffect(() => {
    const off = parti.onState((value) => { const next = value as RoomState; setState(next); setPlayerId(parti.playerId); setSubmittedKey((current) => current.startsWith(`${next.round}:${next.day}:${next.stage}`) ? current : ''); if (next.stage === 'waiting') setPrivateRole(null); });
    const listeners = [
      parti.onEvent('werewolf:role', (p) => { setPrivateRole(p as PrivateRole); setRoleOpen(true); }),
      parti.onEvent('werewolf:pack', (p) => setPack((p as { playerIds: string[] }).playerIds)),
      parti.onEvent('werewolf:pack-votes', (p) => setPackVotes((p as { votes: Array<{ voterId: string; targetId: string }> }).votes)),
      parti.onEvent('werewolf:lover', (p) => setLover((p as { playerId: string }).playerId)),
      parti.onEvent('werewolf:seer-result', (p) => { const v = p as { playerId: string; alignment: string }; setSeerResult(`${playerName(state, v.playerId)} · ${v.alignment === 'werewolf' ? '狼人阵营' : '好人阵营'}`); }),
      parti.onEvent('werewolf:witch-night', (p) => setWitchInfo(p as { killedPlayerId: string | null })),
      parti.onEvent('werewolf:wolf-chat', (p) => setWolfChat((p as { messages: ChatMessage[] }).messages ?? [])),
    ]; parti.exposeToAgent?.(() => buildWerewolfGuide(agentRef.current, parti.playerId)); parti.ready(); return () => { off(); listeners.forEach((fn) => fn()); };
  }, []);
  const isHost = Boolean(state && playerId === state.hostId); const stageKey = state ? `${state.round}:${state.day}:${state.stage}:${state.submittedCount}` : '';
  const submitted = submittedKey.startsWith(state ? `${state.round}:${state.day}:${state.stage}` : 'none');
  const localCardsRecord = Object.fromEntries(boxCards.map((c) => [c.id, { role: c.role }])); const boxResult = boxCards.length ? resolveWinner(localCardsRecord, boxDeaths.map((d) => d.playerId), boxLovers, boxRules) : null;
  function submit(payload: unknown) { if (!state) return; setSubmittedKey(`${state.round}:${state.day}:${state.stage}`); void parti.action('stage:submit', payload); }
  const amWolf = privateRole?.role === 'werewolf';
  const isNight = Boolean(state && ['cupid', 'guard', 'werewolf', 'witch', 'seer'].includes(state.stage));
  const amAlive = Boolean(state && playerId && state.dealtPlayerIds.includes(playerId) && !state.deadPlayerIds.includes(playerId));
  const isMySpeak = Boolean(state?.stage === 'day-speech' && state.currentSpeakerId === playerId);
  const canPublicChat = Boolean(state && amAlive && !isNight && state.stage !== 'waiting' && state.stage !== 'finished');
  const canWolfChat = Boolean(state && amAlive && amWolf && isNight);
  agentRef.current = { state, role: privateRole?.role ?? null, pack, lover, wolfChat, witchInfo, submitted };
  function submitSpeak() { const text = speakText.trim(); if (!text) return; void parti.action('speak', { text }); setSpeakText(''); }
  function submitChat(channel: 'public' | 'wolf') { const text = chatText.trim(); if (!text) return; void parti.action('chat', channel === 'wolf' ? { text, channel: 'wolf' } : { text }); setChatText(''); }
  function changeOnlineRoles(roles: Role[]) { if (!state) return; setState({ ...state, configuredRoles: roles }); if (!validateDeck(roles, state.players.length)) void parti.action('settings:setDeck', { roles }); }
  function changeOnlineRules(rules: RuleSettings) { if (!state) return; setState({ ...state, rules }); void parti.action('settings:setRules', rules); }
  function dealBox() { const ids = Array.from({ length: boxCount }, (_, i) => String(i + 1)); const dealt = dealRoles(ids, boxRoles, Math.random); setBoxCards(ids.map((id) => ({ id, role: dealt[id].role, seen: false }))); setBoxDeaths([]); setBoxLovers([]); setDealOpen(false); }
  function markBoxDeath(id: string, cause: DeathCause) { setBoxDeaths((d) => addDeathsWithHeartbreak(d, [{ playerId: id, cause }], boxLovers, 0)); }
  const opened = boxCards.find((c) => c.id === boxOpen);
  return <main className="app-shell" data-mode={mode}>
    <header><div className="sigil">月</div><div><p className="eyebrow">MOONLIT JUDGEMENT</p><h1>狼人杀 · 月夜审判</h1></div><nav><button className={mode === 'online' ? 'active' : ''} onClick={() => setMode('online')}>联机模式</button><button className={mode === 'box' ? 'active' : ''} onClick={() => setMode('box')}>牌盒模式</button></nav></header>
    {mode === 'online' ? <section className="game-layout">
      <article className="moon-panel">
        <div className="moon" /><p className="eyebrow">第 {state?.day ?? 0} 日 · 第 {state?.round ?? 0} 局</p><h2>{state ? STAGE_COPY[state.stage].title : '连接月夜中'}</h2><p>{state ? STAGE_COPY[state.stage].note : '正在等待房间状态'}</p>
        {state?.stage === 'day-speech' && <div className="speak-box">{isMySpeak ? <><div className="night-hint">轮到你发言</div><textarea value={speakText} maxLength={200} placeholder="发表你的白天发言" onChange={(e) => setSpeakText(e.target.value)} /><button className="primary" disabled={!speakText.trim()} onClick={submitSpeak}>发言</button></> : <div className="submitted"><p>{state.currentSpeakerId ? `${playerName(state, state.currentSpeakerId)} 正在发言…` : '发言即将结束'}</p></div>}</div>}
        {state && state.stage !== 'waiting' && state.stage !== 'finished' && state.stage !== 'day-speech' && <StageAction key={stageKey} state={state} submitted={submitted} role={privateRole?.role ?? null} playerId={playerId} witchInfo={witchInfo} onSubmit={submit} onBadge={(targetId) => void parti.action('sheriff:badge', { targetId })} />}
        {state?.stage === 'waiting' && isHost && <button className="primary" onClick={() => setDealOpen(true)}>打开发牌台</button>}
        {state?.stage === 'waiting' && !isHost && <div className="submitted"><p>等待房主配置身份牌</p></div>}
        {state?.stage === 'finished' && state.result && <div className="result"><strong>{state.result.winner === 'village' ? '好人胜利' : state.result.winner === 'werewolves' ? '狼人胜利' : '情侣胜利'}</strong><p>{state.result.reason}</p>{isHost && <button className="primary" onClick={() => void parti.action('game:restart')}>返回发牌台</button>}</div>}
        {privateRole && <button className="text-button" onClick={() => setRoleOpen(true)}>再次查看我的身份</button>}
        {seerResult && <div className="private-note">最近验人：{seerResult}</div>}
        {lover && <div className="private-note">你的情侣：{playerName(state, lover)}</div>}
        {state?.stage === 'werewolf' && privateRole?.role === 'werewolf' && packVotes.length > 0 && <div className="private-note">狼队密票：{packVotes.map((vote) => `${playerName(state, vote.voterId)}→${playerName(state, vote.targetId)}`).join(' · ')}</div>}
      </article>
      <aside className="roster-panel"><div className="panel-head"><div><p className="eyebrow">THE VILLAGE</p><h2>村庄名册</h2></div><b>{state?.players.length ?? 0}/12</b></div><ul>{state?.players.map((p) => <li key={p.id} className={state.deadPlayerIds.includes(p.id) ? 'dead' : ''}><span className="avatar">{p.name.slice(0, 1)}</span><div><strong>{p.name}{p.id === playerId ? ' · 你' : ''}</strong><small>{state.deadPlayerIds.includes(p.id) ? '已死亡' : state.sheriffId === p.id ? '警长' : state.dealtPlayerIds.includes(p.id) ? '存活' : '等待发牌'}</small></div>{state.stage === 'finished' && state.revealedRoles?.[p.id] && <em>{ROLE_META[state.revealedRoles[p.id]].name}</em>}</li>)}</ul>{state?.lastVotes.length ? <div className="vote-record"><strong>最近票型</strong>{state.lastVotes.map((v) => <small key={v.voterId}>{playerName(state, v.voterId)} → {playerName(state, v.targetId)}{v.weight === 1.5 ? ' ×1.5' : ''}</small>)}</div> : null}{state?.notice && <p className="notice">{state.notice}</p>}{isHost && state?.stage !== 'waiting' && <button className="danger outline" onClick={() => void parti.action('game:restart')}>放弃本局并重开</button>}</aside>
      {state && state.stage !== 'waiting' && <section className="chat-panel roster-panel">
        <div className="panel-head"><div><p className="eyebrow">TOWN SQUARE</p><h2>{isNight ? '夜晚' : '公共聊天'}</h2></div></div>
        {canWolfChat && <div className="wolf-chat"><strong>狼人频道</strong><div className="chat-log is-wolf">{wolfChat.length ? wolfChat.map((m) => <div key={m.id} className="chat-msg"><b>{m.name}：</b><span>{m.text}</span></div>) : <em className="chat-empty">狼队还没有留言</em>}</div></div>}
        <div className="chat-log">{state.chat.length ? state.chat.map((m) => <div key={m.id} className={`chat-msg is-${m.kind}`}>{m.kind === 'system' ? <em>{m.text}</em> : <><b>{m.name}{m.kind === 'speech' ? '（发言）' : ''}：</b><span>{m.text}</span></>}</div>) : <em className="chat-empty">还没有公开发言</em>}</div>
        <div className="chat-input">
          <input value={chatText} maxLength={200} placeholder={canWolfChat ? '狼人频道发言…' : canPublicChat ? '公共聊天…' : (isNight ? '夜晚无法公开发言' : '仅存活玩家可发言')} disabled={!canPublicChat && !canWolfChat} onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitChat(canWolfChat ? 'wolf' : 'public'); }} />
          <button className="primary" disabled={(!canPublicChat && !canWolfChat) || !chatText.trim()} onClick={() => submitChat(canWolfChat ? 'wolf' : 'public')}>发送</button>
        </div>
      </section>}
    </section> : <section className="box-layout">
      <aside className="box-tools"><p className="eyebrow">ONE DEVICE DECK</p><h2>月夜牌盒</h2><p>轮流验牌，由真人主持流程；这里只记录死亡并判断胜负。</p><div className="count-step"><button onClick={() => { const n = Math.max(6, boxCount - 1); setBoxCount(n); setBoxRoles([...(RECOMMENDED_DECKS[n])]); setBoxCards([]); }}>−</button><strong>{boxCount} 人</strong><button onClick={() => { const n = Math.min(12, boxCount + 1); setBoxCount(n); setBoxRoles([...(RECOMMENDED_DECKS[n])]); setBoxCards([]); }}>＋</button></div><button className="primary" onClick={() => setDealOpen(true)}>发牌台</button></aside>
      <article className="box-deck"><div className="panel-head"><div><p className="eyebrow">SECRET IDENTITIES</p><h2>{boxResult ? '本局结算' : boxCards.length ? '选择你的号码' : '等待发牌'}</h2></div></div>{boxResult ? <div className="result"><strong>{boxResult.winner === 'village' ? '好人胜利' : boxResult.winner === 'werewolves' ? '狼人胜利' : '情侣胜利'}</strong><p>{boxResult.reason}</p><div className="reveal-list">{boxCards.map((c) => <span key={c.id}>#{c.id} {ROLE_META[c.role].name}</span>)}</div></div> : <div className="card-grid">{boxCards.map((c) => { const dead = boxDeaths.some((d) => d.playerId === c.id); return <button key={c.id} className={`number-card ${c.seen ? 'seen' : ''} ${dead ? 'dead' : ''}`} onClick={() => setBoxOpen(c.id)}><small>{dead ? '已死亡' : c.seen ? '已验牌' : '未查看'}</small><strong>{c.id}</strong><span>点击操作</span></button>; })}</div>}</article>
    </section>}
    {dealOpen && <div className="backdrop"><section className="modal"><button className="close" onClick={() => setDealOpen(false)}>×</button><p className="eyebrow">DEAL TABLE</p><h2>发牌台</h2>{mode === 'online' && state ? <DealTable count={state.players.length} roles={state.configuredRoles} rules={state.rules} onRoles={changeOnlineRoles} onRules={changeOnlineRules} onDeal={() => { setDealOpen(false); void parti.action('game:start'); }} /> : <DealTable count={boxCount} roles={boxRoles} rules={boxRules} onRoles={setBoxRoles} onRules={setBoxRules} onDeal={dealBox} />}</section></div>}
    {roleOpen && privateRole && <div className="backdrop"><section className="modal identity"><span className="role-glyph">{ROLE_META[privateRole.role].icon}</span><p>{ROLE_META[privateRole.role].team}</p><h2>{ROLE_META[privateRole.role].name}</h2><p>{ROLE_META[privateRole.role].description}</p>{privateRole.role === 'werewolf' && <div className="private-note">狼队：{pack.map((id) => playerName(state, id)).join('、')}</div>}<button className="primary" onClick={() => setRoleOpen(false)}>我记住了</button></section></div>}
    {opened && <div className="backdrop"><section className="modal identity"><span className="role-glyph">{ROLE_META[opened.role].icon}</span><p>玩家 {opened.id} · {ROLE_META[opened.role].team}</p><h2>{ROLE_META[opened.role].name}</h2><p>{ROLE_META[opened.role].description}</p><button className="primary" onClick={() => { setBoxCards((cards) => cards.map((c) => c.id === opened.id ? { ...c, seen: true } : c)); setBoxOpen(null); }}>我记住了</button>{opened.seen && !boxDeaths.some((d) => d.playerId === opened.id) && <div className="death-actions">{(['night-kill', 'poison', 'exile', 'hunter-shot', 'heartbreak'] as DeathCause[]).map((cause) => <button key={cause} onClick={() => { markBoxDeath(opened.id, cause); setBoxOpen(null); }}>{({ 'night-kill': '夜杀', poison: '毒杀', exile: '放逐', 'hunter-shot': '猎杀', heartbreak: '殉情' } as Record<string, string>)[cause]}</button>)}</div>}<label className="toggle"><input type="checkbox" checked={boxLovers.includes(opened.id)} disabled={!boxLovers.includes(opened.id) && boxLovers.length >= 2} onChange={(e) => setBoxLovers((ids) => e.target.checked ? [...ids, opened.id] : ids.filter((id) => id !== opened.id))} /><span>标记为情侣</span></label></section></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
