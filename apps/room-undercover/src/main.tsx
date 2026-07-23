import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { blankAppearanceChance, choosePair, dealCards, resolveElimination, undercoverCount, type DealResult, type EliminationResult, type Role, type Winner } from './game-logic';
import { CATEGORIES, CATEGORY_LABELS, type Category } from './categories';
import { WORD_PAIRS } from './word-bank';
import './styles.css';

type DealMode = 'classic' | 'custom';
type AppMode = 'online' | 'share';
type PublicPlayer = { id: string; name: string; role: 'host' | 'player' };
type ChatMessage = { id: string; playerId: string; name: string; text: string; at: number; kind: 'chat' | 'speech' | 'system' };
type RoomState = {
  phase: 'waiting' | 'speaking' | 'transition' | 'voting' | 'finished'; hostId: string | null; players: PublicPlayer[];
  selectedMode: DealMode; selectedIncludeBlank: boolean; roundMode: DealMode | null; selectedCategories: Category[]; round: number; voteRound: number;
  dealtPlayerIds: string[]; eliminatedPlayerIds: string[];
  speakingOrder: string[]; speakingIndex: number; currentSpeakerId: string | null; spokenPlayerIds: string[];
  votes: Record<string, string>; voteCandidates: string[]; revoteTied: boolean; lastEliminatedId: string | null;
  chat: ChatMessage[];
  revealedWords: { civilian: string; undercover: string } | null; winner: Winner | null;
  resultHadBlank: boolean; resultHadUndercover: boolean; notice: string | null;
};
type PrivateCard = { word: string; round: number };
type ShareCard = { number: number; word: string; role: Role; seen: boolean; eliminated: boolean };
type DealSettings = { mode: DealMode; includeBlank: boolean; categories: Category[]; playerCount: number; hasDealt: boolean };
type DealSettingsChange = { mode: DealMode } | { includeBlank: boolean } | { categories: Category[] } | { playerCount: number };
type DealPayload = { civilianWord?: string; undercoverWord?: string };

const MODE_LABELS: Record<DealMode, { name: string; note: string }> = {
  classic: { name: '经典模式', note: '房主参与' },
  custom: { name: '自定义模式', note: '房主填词' },
};
const WINNER_LABELS: Record<Winner, string> = { civilian: '好人胜利', undercover: '卧底胜利', blank: '白板胜利' };

function DealTable({ settings, modes, playerCountRange, notice, onChange, onDeal }: {
  settings: DealSettings;
  modes: DealMode[];
  playerCountRange?: { min: number; max: number };
  notice?: string | null;
  onChange: (change: DealSettingsChange) => void;
  onDeal: (payload: DealPayload) => void;
}) {
  const [civilianWord, setCivilianWord] = useState('');
  const [undercoverWord, setUndercoverWord] = useState('');
  const normalizedCivilianWord = civilianWord.trim();
  const normalizedUndercoverWord = undercoverWord.trim();
  const customWordsValid = Boolean(normalizedCivilianWord && normalizedUndercoverWord && normalizedCivilianWord !== normalizedUndercoverWord && normalizedCivilianWord.length <= 20 && normalizedUndercoverWord.length <= 20);
  const canDeal = settings.playerCount >= 3 && (settings.mode !== 'custom' || customWordsValid);
  const selectedSummary = settings.categories.map((category) => CATEGORY_LABELS[category].name).join(' · ');
  const blankChance = Math.round(blankAppearanceChance(settings.playerCount) * 100);

  function toggleCategory(category: Category) {
    const next = settings.categories.includes(category) ? settings.categories.filter((item) => item !== category) : [...settings.categories, category];
    if (next.length) onChange({ categories: next });
  }

  return <div className="deal-table">
    {playerCountRange && <div className="player-stepper"><span>玩家人数</span><button onClick={() => onChange({ playerCount: Math.max(playerCountRange.min, settings.playerCount - 1) })} disabled={settings.playerCount === playerCountRange.min}>−</button><strong>{settings.playerCount}</strong><button onClick={() => onChange({ playerCount: Math.min(playerCountRange.max, settings.playerCount + 1) })} disabled={settings.playerCount === playerCountRange.max}>＋</button></div>}
    {modes.length > 1 && <div className="mode-grid">{modes.map((mode) => { const meta = MODE_LABELS[mode]; const active = settings.mode === mode; return <button key={mode} className={`mode-card ${active ? 'is-active' : ''}`} onClick={() => onChange({ mode })}><strong>{meta.name}</strong><small>{meta.note}</small></button>; })}</div>}
    <button className={`blank-toggle ${settings.includeBlank ? 'is-active' : ''}`} onClick={() => onChange({ includeBlank: !settings.includeBlank })} aria-pressed={settings.includeBlank}><span>□</span><span><strong>加入白板</strong><small>{settings.playerCount < 6 ? `${blankChance}% 概率出现` : '本局固定出现 · 占用一名卧底'}</small></span><b>{settings.includeBlank ? '已开启' : '未开启'}</b></button>
    {settings.mode !== 'custom' ? <><div className="section-heading category-title"><h3>选择词牌分类</h3><span>{selectedSummary}</span></div><div className="category-grid">{CATEGORIES.map((category) => {
      const meta = CATEGORY_LABELS[category]; const active = settings.categories.includes(category);
      return <button key={category} className={`category ${active ? 'is-active' : ''} ${category === 'nsfw' ? 'is-nsfw' : ''}`} onClick={() => toggleCategory(category)} aria-pressed={active}><span className="category-icon">{meta.icon}</span><span><strong>{meta.name}</strong><small>{meta.note}</small></span><span className="check">✓</span></button>;
    })}</div></> : <div className="custom-words"><label>平民词<input maxLength={20} value={civilianWord} onChange={(event) => setCivilianWord(event.target.value)} placeholder="例如：咖啡" /></label><label>卧底词<input maxLength={20} value={undercoverWord} onChange={(event) => setUndercoverWord(event.target.value)} placeholder="例如：奶茶" /></label></div>}
    <button className="deal-button" disabled={!canDeal} onClick={() => onDeal(settings.mode === 'custom' ? { civilianWord: normalizedCivilianWord, undercoverWord: normalizedUndercoverWord } : {})}><span>{settings.hasDealt ? '重新洗牌并发牌' : '洗牌并发牌'}</span><small>{settings.playerCount < 3 ? `还差 ${3 - settings.playerCount} 名收牌玩家` : settings.mode === 'custom' && !customWordsValid ? '请填写两个不同的词语' : settings.includeBlank ? `${settings.playerCount} 人收牌 · 白板${settings.playerCount < 6 ? `出现率 ${blankChance}%` : '固定出现'}` : `${settings.playerCount} 人收牌 · ${undercoverCount(settings.playerCount)} 名卧底`}</small></button>
    {notice && <p className="notice">{notice}</p>}
  </div>;
}

// AI agent 转述：运行在本玩家视角的 UI 内，只读本玩家可见信息（自己的词从私密 card 事件拿）。
// 内容与逻辑迁移自旧 worker 侧 describe()/undercoverObserve()，改为读客户端本地状态。
const UNDERCOVER_GUIDE = {
  summary: '谁是卧底：多数是「平民」拿到同一个词，少数「卧底」拿到相近词，可能有「白板」无词。轮流发言描述自己的词、再投票淘汰可疑者。',
  objective: '平民/白板要找出并投出所有卧底；卧底要隐藏身份活到与平民人数相等。发言只能通过聊天室进行——描述你的词但不能直接说出它。',
  actions: [
    { name: 'speak', description: '发言阶段轮到你时发表一条描述（结构化发言，进入公共聊天）。', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] }, examples: [{ text: '我的词是一种常见饮品，早上常喝。' }] },
    { name: 'vote', description: '投票阶段投出你怀疑的卧底。targetId 为候选玩家 id，传空字符串表示弃票。', payloadSchema: { type: 'object', properties: { targetId: { type: 'string' } }, required: ['targetId'] } },
    { name: 'chat', description: '任意讨论阶段发送自由聊天消息（存活玩家）。', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] } },
    { name: 'round:deal', description: '（房主）发牌开始新一局。', payloadSchema: { type: 'object', properties: { civilianWord: { type: 'string' }, undercoverWord: { type: 'string' } } } },
  ],
  glossary: {
    phase: 'waiting=等待发牌, speaking=轮流发言, transition=转场过渡, voting=投票, finished=结束',
    currentSpeakerId: '发言阶段当前应发言的玩家 id。',
    speakingOrder: '本轮发言顺序（存活玩家）。',
    voteCandidates: '投票阶段可被投的候选玩家 id（平票重投时仅为并列者）。',
    votes: '已投票记录，键为投票者 id，值为目标 id（空串=弃票）。',
    eliminatedPlayerIds: '已出局玩家 id。',
    chat: '公共聊天与发言记录（kind: speech=结构化发言, chat=自由聊天, system=系统提示）。',
    revoteTied: '当前是否为平票后的重投。',
  },
} as const;

function undercoverChatDigest(state: RoomState, limit = 12): string[] {
  return state.chat.slice(-limit).map((msg) => msg.kind === 'system' ? `[系统] ${msg.text}` : `${msg.name}${msg.kind === 'speech' ? '(发言)' : ''}: ${msg.text}`);
}

function buildUndercoverGuide(state: RoomState | null, card: PrivateCard | null, playerId: string | null) {
  if (!state || !playerId) return { ...UNDERCOVER_GUIDE, phase: 'connecting', narrative: '正在连接房间…', isYourTurn: false, availableActions: [] };
  const nameFrom = (id: string) => state.players.find((player) => player.id === id)?.name ?? '玩家';
  const hasCard = Boolean(card && card.round === state.round);
  const inGame = state.dealtPlayerIds.includes(playerId);
  const eliminated = state.eliminatedPlayerIds.includes(playerId);
  const roster = state.players.map((p) => `${p.name}${state.eliminatedPlayerIds.includes(p.id) ? '(出局)' : ''}`).join('，');
  const wordLine = hasCard ? (card!.word ? `你的词是「${card!.word}」。` : '你是白板（没有词）。') : '你未参与本局。';
  const base = `第 ${state.round} 轮。${wordLine} 在场：${roster}。`;
  const recent = undercoverChatDigest(state);
  const chatAction = { name: 'chat', hint: '自由发言', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] } };
  const g = UNDERCOVER_GUIDE;

  if (state.phase === 'waiting') {
    return { ...g, phase: 'waiting', narrative: `${base} 等待房主发牌。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: '等待房主发牌' };
  }
  if (state.phase === 'finished') {
    const winnerLabel = state.winner === 'undercover' ? '卧底胜利' : state.winner === 'blank' ? '白板胜利' : '好人胜利';
    return { ...g, phase: 'finished', narrative: `${base} ${winnerLabel}。平民词「${state.revealedWords?.civilian ?? ''}」，卧底词「${state.revealedWords?.undercover ?? ''}」。`, isYourTurn: false, availableActions: [], recentEvents: recent };
  }
  if (!inGame || eliminated) {
    return { ...g, phase: state.phase, narrative: `${base} 你${eliminated ? '已出局' : '未参与'}，只能旁观聊天。`, isYourTurn: false, availableActions: [], recentEvents: recent, waitingFor: '旁观中' };
  }
  if (state.phase === 'speaking') {
    if (state.currentSpeakerId === playerId) {
      return { ...g, phase: 'speaking', narrative: `${base} 轮到你发言，描述你的词但别直接说出它。`, isYourTurn: true, availableActions: [{ name: 'speak', hint: '发表你的描述', payloadSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] } }, chatAction], recentEvents: recent };
    }
    const speaker = state.currentSpeakerId ? nameFrom(state.currentSpeakerId) : '其他玩家';
    return { ...g, phase: 'speaking', narrative: `${base} 轮到 ${speaker} 发言。`, isYourTurn: false, availableActions: [chatAction], recentEvents: recent, waitingFor: `等待 ${speaker} 发言` };
  }
  if (state.phase === 'transition') {
    return { ...g, phase: 'transition', narrative: `${base} 发言结束，即将投票。`, isYourTurn: false, availableActions: [chatAction], recentEvents: recent, waitingFor: '等待进入投票' };
  }
  if (state.phase === 'voting') {
    if (playerId in state.votes) {
      return { ...g, phase: 'voting', narrative: `${base} 你已投票，等待其他人。`, isYourTurn: false, availableActions: [chatAction], recentEvents: recent, waitingFor: '等待其他玩家投票' };
    }
    const candidates = state.voteCandidates.filter((id) => id !== playerId);
    return { ...g, phase: 'voting', narrative: `${base} ${state.revoteTied ? '平票重投，' : ''}投出你怀疑的卧底。`, isYourTurn: true, availableActions: [{ name: 'vote', hint: '选择目标 id 投票，或传空串弃票', payloadSchema: { type: 'object', properties: { targetId: { enum: [...candidates, ''] } }, required: ['targetId'] } }, chatAction], recentEvents: recent };
  }
  return { ...g, phase: state.phase, narrative: base, isYourTurn: false, availableActions: [chatAction], recentEvents: recent };
}

function App() {
  const [appMode, setAppMode] = useState<AppMode>('online');
  const [state, setState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [card, setCard] = useState<PrivateCard | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [dealTableOpen, setDealTableOpen] = useState(false);
  const [speakText, setSpeakText] = useState('');
  const [chatText, setChatText] = useState('');
  const [sharePlayerCount, setSharePlayerCount] = useState(6);
  const [shareCategories, setShareCategories] = useState<Category[]>(['entertainment', 'daily']);
  const [shareIncludeBlank, setShareIncludeBlank] = useState(false);
  const [shareCards, setShareCards] = useState<ShareCard[]>([]);
  const [shareDeal, setShareDeal] = useState<DealResult | null>(null);
  const [openShareCard, setOpenShareCard] = useState<number | null>(null);
  const [manageShareCard, setManageShareCard] = useState<number | null>(null);
  const [shareResult, setShareResult] = useState<EliminationResult | null>(null);
  const usedSharePairs = useRef(new Set<string>());
  const agentRef = useRef<{ state: RoomState | null; card: PrivateCard | null }>({ state: null, card: null });

  useEffect(() => {
    const offState = parti.onState((nextState) => {
      const roomState = nextState as RoomState;
      agentRef.current.state = roomState;
      setState(roomState); setPlayerId(parti.playerId);
      setCard((current) => current?.round === roomState.round ? current : null); setRevealed(false);
    });
    const offCard = parti.onEvent('undercover:card', (payload) => { agentRef.current.card = payload as PrivateCard; setCard(payload as PrivateCard); setRevealed(false); });
    parti.exposeToAgent?.(() => buildUndercoverGuide(agentRef.current.state, agentRef.current.card, parti.playerId));
    parti.ready();
    return () => { offState(); offCard(); };
  }, []);

  useEffect(() => {
    if (!dealTableOpen && openShareCard === null && manageShareCard === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDealTableOpen(false); setOpenShareCard(null); setManageShareCard(null);
    };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [dealTableOpen, openShareCard, manageShareCard]);

  const isHost = Boolean(playerId && state?.hostId === playerId);
  const hasCurrentCard = Boolean(card && state && card.round === state.round);
  const isEliminated = Boolean(playerId && state?.eliminatedPlayerIds.includes(playerId));
  const living = state ? state.dealtPlayerIds.filter((id) => !state.eliminatedPlayerIds.includes(id)) : [];
  const amLiving = Boolean(playerId && living.includes(playerId));
  const isMyTurnToSpeak = Boolean(state?.phase === 'speaking' && state.currentSpeakerId === playerId);
  const hasVoted = Boolean(state && playerId && playerId in state.votes);
  const nameById = (id: string) => state?.players.find((player) => player.id === id)?.name ?? '玩家';
  const currentSpeakerName = state?.currentSpeakerId ? nameById(state.currentSpeakerId) : '';
  const isRoundActive = Boolean(state && state.phase !== 'waiting');
  const phaseTitle = state?.phase === 'speaking' ? '发言阶段' : state?.phase === 'transition' ? '转场' : state?.phase === 'voting' ? '投票阶段' : state?.phase === 'finished' ? '本局结束' : '';
  const phaseHint = state?.phase === 'speaking' ? `轮到 ${currentSpeakerName} 发言` : state?.phase === 'transition' ? '发言结束，即将进入投票' : state?.phase === 'voting' ? (state.revoteTied ? '平票重投，仅可在并列者中选择' : '请投出你怀疑的卧底') : '';
  const participantCount = state?.players.filter((player) => state.selectedMode === 'classic' || player.role !== 'host').length ?? 0;
  function submitSpeak() { const text = speakText.trim(); if (!text) return; void parti.action('speak', { text }); setSpeakText(''); }
  function submitChat() { const text = chatText.trim(); if (!text) return; void parti.action('chat', { text }); setChatText(''); }
  function castVote(targetId: string) { void parti.action('vote', { targetId }); }
  function changeRoomDealSettings(change: DealSettingsChange) {
    if ('mode' in change) void parti.action('settings:setMode', { mode: change.mode });
    if ('includeBlank' in change) void parti.action('settings:setIncludeBlank', { enabled: change.includeBlank });
    if ('categories' in change) void parti.action('settings:setCategories', { categories: change.categories });
  }
  function changeShareDealSettings(change: DealSettingsChange) {
    if ('categories' in change) setShareCategories(change.categories);
    if ('playerCount' in change) setSharePlayerCount(change.playerCount);
    if ('includeBlank' in change) setShareIncludeBlank(change.includeBlank);
    setShareCards([]); setShareDeal(null); setShareResult(null);
  }
  function dealRound(payload: DealPayload) {
    void parti.action('round:deal', payload);
    setDealTableOpen(false);
  }
  function dealShareCards(_payload: DealPayload) {
    const candidates = WORD_PAIRS.filter((pair) => shareCategories.includes(pair.category));
    const { pair, reset } = choosePair(candidates, usedSharePairs.current, Math.random);
    if (reset) usedSharePairs.current.clear();
    usedSharePairs.current.add(pair.id);
    const ids = Array.from({ length: sharePlayerCount }, (_, index) => String(index + 1));
    const dealt = dealCards(ids, pair, Math.random, shareIncludeBlank);
    setShareDeal(dealt);
    setShareCards(ids.map((id) => ({ number: Number(id), word: dealt.cards[id].word, role: dealt.cards[id].role, seen: false, eliminated: false })));
    setOpenShareCard(null);
    setManageShareCard(null);
    setShareResult(null);
    setDealTableOpen(false);
  }
  function rememberShareCard() {
    if (openShareCard === null) return;
    setShareCards((cards) => cards.map((item) => item.number === openShareCard ? { ...item, seen: true } : item));
    setOpenShareCard(null);
  }

  function selectShareCard(item: ShareCard) {
    if (shareResult) return;
    if (item.seen) setManageShareCard(item.number);
    else setOpenShareCard(item.number);
  }

  function eliminateShareCard() {
    if (manageShareCard === null) return;
    const nextCards = shareCards.map((item) => item.number === manageShareCard ? { ...item, eliminated: true } : item);
    const eliminatedIds = nextCards.filter((item) => item.eliminated).map((item) => String(item.number));
    if (!shareDeal) return;
    const result = resolveElimination(shareDeal, eliminatedIds);
    setShareCards(nextCards);
    setManageShareCard(null);
    if (result.finished && result.revealedWords) setShareResult(result);
  }

  const openShare = shareCards.find((item) => item.number === openShareCard);
  const managedShare = shareCards.find((item) => item.number === manageShareCard);
  const dealTableSettings: DealSettings = appMode === 'share'
    ? { mode: 'classic', includeBlank: shareIncludeBlank, categories: shareCategories, playerCount: sharePlayerCount, hasDealt: shareCards.length > 0 }
    : { mode: state?.selectedMode ?? 'classic', includeBlank: state?.selectedIncludeBlank ?? false, categories: state?.selectedCategories ?? ['entertainment', 'daily'], playerCount: participantCount, hasDealt: Boolean(state?.round) };
  const dealTableModes: DealMode[] = appMode === 'share' ? ['classic'] : ['classic', 'custom'];
  const dealTablePlayerRange = appMode === 'share' ? { min: 3, max: 12 } : undefined;
  const changeDealSettings = appMode === 'share' ? changeShareDealSettings : changeRoomDealSettings;
  const submitDeal = appMode === 'share' ? dealShareCards : dealRound;
  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">卧</div>
      <div className="brand-copy"><p className="eyebrow">PARTI PARTY DECK</p><h1>谁是卧底</h1></div>
      <nav className="mode-switch" aria-label="游戏模式">
        <button className={appMode === 'online' ? 'is-active' : ''} onClick={() => setAppMode('online')}>联机模式</button>
        <button className={appMode === 'share' ? 'is-active' : ''} onClick={() => setAppMode('share')}>牌盒模式</button>
      </nav>
      {appMode === 'online' && <span className="round-chip">第 {state?.round ?? 0} 轮</span>}
    </header>

    {appMode === 'share' ? <section className="share-layout">
      <div className="share-toolbar panel">
        <div className="share-intro"><p className="eyebrow">PASS THE PHONE</p><h2>一台手机，也能秘密发牌</h2><p>依次点开自己的序号，记住词语后把手机交给下一位。</p></div>
        <button className="host-button" onClick={() => setDealTableOpen(true)}>发牌台 <span>›</span></button>
      </div>
      <div className="share-deck panel">
        <div className="section-heading"><div><p className="eyebrow">SECRET DECK</p><h2>{shareResult ? '本轮结算' : shareCards.length ? '请选择你的序号' : '等待发牌'}</h2></div>{shareCards.length > 0 && !shareResult && <span>{shareCards.filter((item) => item.seen).length}/{shareCards.length} 已查看</span>}</div>
        {shareResult && shareResult.winner && shareResult.revealedWords ? <div className="share-result"><p className="eyebrow">ROUND COMPLETE</p><h3>{WINNER_LABELS[shareResult.winner]}</h3><div><span><small>好人词</small><strong>{shareResult.revealedWords.civilian}</strong></span><i>VS</i><span><small>{shareResult.hadUndercover ? '卧底词' : '本局未发卧底'}</small><strong>{shareResult.revealedWords.undercover}</strong></span></div><p>{shareResult.hadBlank ? '本局有白板。' : '本局没有白板。'} 点击左侧按钮重新洗牌。</p></div> : shareCards.length ? <div className="card-grid">{shareCards.map((item) => <button key={item.number} className={`number-card ${item.seen ? 'is-seen' : ''} ${item.eliminated ? 'is-eliminated' : ''}`} onClick={() => selectShareCard(item)} disabled={item.eliminated}><small>{item.eliminated ? '已出局' : item.seen ? '已看过' : '未查看'}</small><strong>{item.number}</strong><span>{item.eliminated ? '×' : item.seen ? '点击操作' : '点击翻牌'}</span></button>)}</div> : <div className="empty-deck"><span>✦</span><p>选择人数与牌盒分类，然后发牌</p></div>}
      </div>
    </section> : <section className="online-layout">
      <article className={`secret-card ${revealed ? 'is-revealed' : ''}`}>
        {state?.phase === 'finished' && state.revealedWords && state.winner ? <div className="online-result">
          <div className="stage-icon">结</div>
          <p className="eyebrow">ROUND COMPLETE</p>
          <h2>{WINNER_LABELS[state.winner]}</h2>
          <p>本轮身份已全部揭晓</p>
          <div className="result-words">
            <span><small>好人词</small><strong>{state.revealedWords.civilian}</strong></span>
            <i>VS</i>
            <span><small>{state.resultHadUndercover ? '卧底词' : '本局未发卧底'}</small><strong>{state.revealedWords.undercover}</strong></span>
          </div>
          <small className="result-note">{state.resultHadBlank ? '本局有白板' : '本局无白板'}</small>
          {isHost ? <button className="card-action stage-primary" onClick={() => setDealTableOpen(true)}>开始下一轮</button> : <div className="waiting-message">等待房主开启下一轮</div>}
        </div>
        : card && hasCurrentCard && revealed ? <><p className="card-kicker">{card.word ? '你的词语' : '你是白板'}</p><div className={`secret-word ${card.word ? '' : 'is-blank'}`}>{card.word || '空白牌'}</div>{card.word ? <p>记住它，然后把牌藏好。</p> : <p>没有词，也不会因说中词里的字而自爆。<br />请保持镇定，假装一切尽在掌握。</p>}<button className="card-action ghost" onClick={() => setRevealed(false)}>我记住了</button></>
        : hasCurrentCard ? <><div className="sealed-icon">✦</div><p className="eyebrow stage-kicker">SECRET CARD</p><h2>你的牌已送达</h2><p>确认没人偷看，再翻开牌面。</p><button className="card-action" onClick={() => setRevealed(true)}>查看我的词牌</button></>
        : !state ? <><div className="waiting-orbit"><span /></div><h2>正在连接牌桌</h2><p>正在获取房间状态，请稍候。</p></>
        : state.phase === 'waiting' && isHost ? <><div className="stage-icon">发</div><p className="eyebrow stage-kicker">HOST CONTROLS</p><h2>{state.round ? '准备重新发牌' : '准备开始第一轮'}</h2><p>进入发牌台选择词牌、模式和白板规则。</p><button className="card-action stage-primary" onClick={() => setDealTableOpen(true)}>打开发牌台</button><small className="stage-note">{participantCount >= 3 ? `${participantCount} 人已就位` : `至少需要 3 名收牌玩家 · 当前 ${participantCount} 人`}</small></>
        : state.phase === 'waiting' ? <><div className="stage-icon is-muted">候</div><p className="eyebrow stage-kicker">WAITING FOR HOST</p><h2>等待房主发牌</h2><p>房主正在配置词牌与规则，发牌后你的秘密词语会出现在这里。</p><div className="waiting-message">已入座 · 等待开局</div></>
        : <><div className="stage-icon is-muted">游</div><p className="eyebrow stage-kicker">ROUND IN PROGRESS</p><h2>{isHost && state.roundMode === 'custom' ? '本轮主持中' : '本轮进行中'}</h2><p>{isHost && state.roundMode === 'custom' ? '词牌已发给所有参与玩家，你可以专心主持描述与投票。' : '你未参与当前轮次，可以旁观并等待下一轮发牌。'}</p><div className="waiting-message">第 {state.round} 轮正在进行</div></>}
      </article>
      <aside className="table-panel panel">
        <div className="section-heading"><div><p className="eyebrow">AT THE TABLE</p><h2>在场玩家</h2></div><b>{state?.players.length ?? 0}/12</b></div>
        <ul className="roster">{state?.players.map((player, index) => <li key={player.id}><span className={`avatar avatar-${index % 5}`}>{player.name.slice(0, 1)}</span><span className="player-name">{player.name}{player.id === playerId && <small>你</small>}</span>{state.eliminatedPlayerIds.includes(player.id) ? <em>已出局</em> : player.role === 'host' ? <em>房主</em> : state.dealtPlayerIds.includes(player.id) ? <i>●</i> : null}</li>)}</ul>
        <div className="table-actions">
          {isHost && isRoundActive && <button className="host-button is-secondary" onClick={() => setDealTableOpen(true)}>重新发牌 <span>›</span></button>}
        </div>
      </aside>
      {isRoundActive && state && <section className="play-panel panel">
        <div className="section-heading"><div><p className="eyebrow">DISCUSSION</p><h2>{phaseTitle}</h2></div>{state.phase === 'voting' && <span>{Object.keys(state.votes).length}/{living.length} 已投</span>}</div>
        {phaseHint && <p className="phase-hint">{phaseHint}{isEliminated ? ' · 你已出局，仅可旁观' : ''}</p>}
        {isMyTurnToSpeak && <div className="speak-box">
          <textarea value={speakText} maxLength={200} placeholder="轮到你发言，描述你的词（别直接说出来）" onChange={(event) => setSpeakText(event.target.value)} />
          <button className="deal-button" disabled={!speakText.trim()} onClick={submitSpeak}><span>发言</span></button>
        </div>}
        {state.phase === 'voting' && amLiving && !hasVoted && <div className="vote-box">
          <p>投出你怀疑的卧底：</p>
          <div className="vote-grid">
            {state.voteCandidates.filter((id) => id !== playerId).map((id) => <button key={id} className="vote-option" onClick={() => castVote(id)}>{nameById(id)}</button>)}
            <button className="vote-option is-abstain" onClick={() => castVote('')}>弃票</button>
          </div>
        </div>}
        {state.phase === 'voting' && hasVoted && <p className="phase-hint">你已投票，等待其他玩家。</p>}
        <div className="chat-log">{state.chat.map((msg) => <div key={msg.id} className={`chat-msg is-${msg.kind}`}>{msg.kind === 'system' ? <em>{msg.text}</em> : <><b>{msg.name}{msg.kind === 'speech' ? '（发言）' : ''}：</b><span>{msg.text}</span></>}</div>)}</div>
        <div className="chat-input">
          <input value={chatText} maxLength={200} placeholder={amLiving ? '自由聊天…' : '出局后仅可旁观'} disabled={!amLiving} onChange={(event) => setChatText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitChat(); }} />
          <button disabled={!amLiving || !chatText.trim()} onClick={submitChat}>发送</button>
        </div>
      </section>}
    </section>}

    {dealTableOpen && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDealTableOpen(false)}><section className="modal host-modal" role="dialog" aria-modal="true" aria-labelledby="deal-table-title">
      <div className="modal-head"><div><p className="eyebrow">DEAL TABLE</p><h2 id="deal-table-title">发牌台</h2></div><button className="close-button" onClick={() => setDealTableOpen(false)}>×</button></div>
      <DealTable settings={dealTableSettings} modes={dealTableModes} playerCountRange={dealTablePlayerRange} notice={appMode === 'online' ? state?.notice : null} onChange={changeDealSettings} onDeal={submitDeal} />
    </section></div>}

    {openShare && <div className="modal-backdrop"><section className="modal share-card-modal" role="dialog" aria-modal="true" aria-labelledby="share-word"><span className="share-number">玩家 {openShare.number}</span><p>{openShare.word ? '你的词语' : '你是白板'}</p><strong id="share-word">{openShare.word || '空白牌'}</strong>{openShare.word ? <small>记住序号和词语，不要让别人看到</small> : <small>没有词，也不会因说中词里的字而自爆。<br />请保持镇定，假装一切尽在掌握。</small>}<button className="deal-button" onClick={rememberShareCard}><span>我记住了</span></button></section></div>}
    {managedShare && <div className="modal-backdrop"><section className="modal share-action-modal" role="dialog" aria-modal="true" aria-labelledby="share-action-title"><span className="share-number">玩家 {managedShare.number}</span><h2 id="share-action-title">这张牌怎么了？</h2><p>重新查看会再次展示秘密词语；无论投票还是自爆，确认出局后不能撤销。</p><div className="share-action-buttons"><button onClick={() => { setManageShareCard(null); setOpenShareCard(managedShare.number); }}>忘了，再看一次</button><button className="danger" onClick={eliminateShareCard}>确认出局</button></div><button className="text-button" onClick={() => setManageShareCard(null)}>取消</button></section></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
