import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { blankAppearanceChance, choosePair, dealCards, resolveElimination, undercoverCount, type DealResult, type EliminationResult, type Role, type Winner } from './game-logic';
import { CATEGORIES, CATEGORY_LABELS, type Category } from './categories';
import { WORD_PAIRS } from './word-bank';
import './styles.css';

type DealMode = 'classic' | 'custom';
type AppMode = 'online' | 'share';
type PublicPlayer = { id: string; name: string; role: 'host' | 'player' };
type RoomState = {
  phase: 'waiting' | 'active' | 'finished'; hostId: string | null; players: PublicPlayer[];
  selectedMode: DealMode; selectedIncludeBlank: boolean; roundMode: DealMode | null; selectedCategories: Category[]; round: number;
  dealtPlayerIds: string[]; eliminatedPlayerIds: string[];
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

function App() {
  const [appMode, setAppMode] = useState<AppMode>('online');
  const [state, setState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [card, setCard] = useState<PrivateCard | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [dealTableOpen, setDealTableOpen] = useState(false);
  const [eliminateModalOpen, setEliminateModalOpen] = useState(false);
  const [sharePlayerCount, setSharePlayerCount] = useState(6);
  const [shareCategories, setShareCategories] = useState<Category[]>(['entertainment', 'daily']);
  const [shareIncludeBlank, setShareIncludeBlank] = useState(false);
  const [shareCards, setShareCards] = useState<ShareCard[]>([]);
  const [shareDeal, setShareDeal] = useState<DealResult | null>(null);
  const [openShareCard, setOpenShareCard] = useState<number | null>(null);
  const [manageShareCard, setManageShareCard] = useState<number | null>(null);
  const [shareResult, setShareResult] = useState<EliminationResult | null>(null);
  const usedSharePairs = useRef(new Set<string>());

  useEffect(() => {
    const offState = parti.onState((nextState) => {
      const roomState = nextState as RoomState;
      setState(roomState); setPlayerId(parti.playerId);
      setCard((current) => current?.round === roomState.round ? current : null); setRevealed(false);
    });
    const offCard = parti.onEvent('undercover:card', (payload) => { setCard(payload as PrivateCard); setRevealed(false); });
    parti.ready();
    return () => { offState(); offCard(); };
  }, []);

  useEffect(() => {
    if (!dealTableOpen && !eliminateModalOpen && openShareCard === null && manageShareCard === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDealTableOpen(false); setEliminateModalOpen(false); setOpenShareCard(null); setManageShareCard(null);
    };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [dealTableOpen, eliminateModalOpen, openShareCard, manageShareCard]);

  const isHost = Boolean(playerId && state?.hostId === playerId);
  const hasCurrentCard = Boolean(card && state && card.round === state.round);
  const isEliminated = Boolean(playerId && state?.eliminatedPlayerIds.includes(playerId));
  const canEliminateSelf = Boolean(state?.phase === 'active' && playerId && state.dealtPlayerIds.includes(playerId) && !isEliminated);
  const participantCount = state?.players.filter((player) => state.selectedMode === 'classic' || player.role !== 'host').length ?? 0;
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
          {isHost && state?.phase === 'active' && <button className="host-button is-secondary" onClick={() => setDealTableOpen(true)}>重新发牌 <span>›</span></button>}
          {state?.phase === 'active' && hasCurrentCard && <button className="eliminate-button" disabled={!canEliminateSelf} onClick={() => setEliminateModalOpen(true)}>{isEliminated ? '已出局' : '我出局了'}</button>}
        </div>
      </aside>
    </section>}

    {dealTableOpen && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDealTableOpen(false)}><section className="modal host-modal" role="dialog" aria-modal="true" aria-labelledby="deal-table-title">
      <div className="modal-head"><div><p className="eyebrow">DEAL TABLE</p><h2 id="deal-table-title">发牌台</h2></div><button className="close-button" onClick={() => setDealTableOpen(false)}>×</button></div>
      <DealTable settings={dealTableSettings} modes={dealTableModes} playerCountRange={dealTablePlayerRange} notice={appMode === 'online' ? state?.notice : null} onChange={changeDealSettings} onDeal={submitDeal} />
    </section></div>}

    {eliminateModalOpen && <div className="modal-backdrop"><section className="modal confirm-modal" role="dialog" aria-modal="true"><div className="modal-icon">?</div><h2>确认已经出局？</h2><p>无论是被投票还是自爆，确认后都不能撤销，你的阵营仍然保密。</p><div className="modal-actions"><button onClick={() => setEliminateModalOpen(false)}>取消</button><button className="danger" onClick={() => { setEliminateModalOpen(false); void parti.action('round:eliminateSelf'); }}>确认出局</button></div></section></div>}
    {openShare && <div className="modal-backdrop"><section className="modal share-card-modal" role="dialog" aria-modal="true" aria-labelledby="share-word"><span className="share-number">玩家 {openShare.number}</span><p>{openShare.word ? '你的词语' : '你是白板'}</p><strong id="share-word">{openShare.word || '空白牌'}</strong>{openShare.word ? <small>记住序号和词语，不要让别人看到</small> : <small>没有词，也不会因说中词里的字而自爆。<br />请保持镇定，假装一切尽在掌握。</small>}<button className="deal-button" onClick={rememberShareCard}><span>我记住了</span></button></section></div>}
    {managedShare && <div className="modal-backdrop"><section className="modal share-action-modal" role="dialog" aria-modal="true" aria-labelledby="share-action-title"><span className="share-number">玩家 {managedShare.number}</span><h2 id="share-action-title">这张牌怎么了？</h2><p>重新查看会再次展示秘密词语；无论投票还是自爆，确认出局后不能撤销。</p><div className="share-action-buttons"><button onClick={() => { setManageShareCard(null); setOpenShareCard(managedShare.number); }}>忘了，再看一次</button><button className="danger" onClick={eliminateShareCard}>确认出局</button></div><button className="text-button" onClick={() => setManageShareCard(null)}>取消</button></section></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
