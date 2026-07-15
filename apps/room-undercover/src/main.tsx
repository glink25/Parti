import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { choosePair, dealCards, resolveElimination, undercoverCount, type Role } from './game-logic';
import { CATEGORIES, WORD_PAIRS, type Category } from './words';
import './styles.css';

type DealMode = 'classic' | 'blank' | 'custom';
type AppMode = 'online' | 'share';
type PublicPlayer = { id: string; name: string; role: 'host' | 'player' };
type RoomState = {
  phase: 'waiting' | 'active' | 'finished'; hostId: string | null; players: PublicPlayer[];
  selectedMode: DealMode; roundMode: DealMode | null; selectedCategories: Category[]; round: number;
  dealtPlayerIds: string[]; eliminatedPlayerIds: string[];
  revealedWords: { civilian: string; undercover: string } | null; notice: string | null;
};
type PrivateCard = { word: string; round: number };
type ShareCard = { number: number; word: string; role: Role; seen: boolean; eliminated: boolean };
type ShareResult = { civilian: string; undercover: string };
type DealSettings = { mode: DealMode; categories: Category[]; playerCount: number; hasDealt: boolean };
type DealSettingsChange = { mode: DealMode } | { categories: Category[] } | { playerCount: number };
type DealPayload = { civilianWord?: string; undercoverWord?: string };

const CATEGORY_LABELS: Record<Category, { icon: string; name: string; note: string }> = {
  entertainment: { icon: '✦', name: '娱乐', note: '影视 · 音乐 · 游戏' },
  weapons: { icon: '⚔', name: '武器', note: '装备与防具' },
  daily: { icon: '⌂', name: '日常', note: '生活相似物' },
  nsfw: { icon: '♥', name: 'NSFW', note: '含蓄成人向' },
};
const MODE_LABELS: Record<DealMode, { icon: string; name: string; note: string }> = {
  classic: { icon: '双', name: '经典词库', note: '房主参与' },
  blank: { icon: '□', name: '空白牌', note: '房主持局' },
  custom: { icon: '笔', name: '自定义', note: '房主填词' },
};

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

  function toggleCategory(category: Category) {
    const next = settings.categories.includes(category) ? settings.categories.filter((item) => item !== category) : [...settings.categories, category];
    if (next.length) onChange({ categories: next });
  }

  return <div className="deal-table">
    {playerCountRange && <div className="player-stepper"><span>玩家人数</span><button onClick={() => onChange({ playerCount: Math.max(playerCountRange.min, settings.playerCount - 1) })} disabled={settings.playerCount === playerCountRange.min}>−</button><strong>{settings.playerCount}</strong><button onClick={() => onChange({ playerCount: Math.min(playerCountRange.max, settings.playerCount + 1) })} disabled={settings.playerCount === playerCountRange.max}>＋</button></div>}
    {modes.length > 1 && <div className="mode-grid">{modes.map((mode) => { const meta = MODE_LABELS[mode]; const active = settings.mode === mode; return <button key={mode} className={`mode-card ${active ? 'is-active' : ''}`} onClick={() => onChange({ mode })}><span>{meta.icon}</span><strong>{meta.name}</strong><small>{meta.note}</small></button>; })}</div>}
    {settings.mode !== 'custom' ? <><div className="section-heading category-title"><h3>选择词牌分类</h3><span>{selectedSummary}</span></div><div className="category-grid">{CATEGORIES.map((category) => {
      const meta = CATEGORY_LABELS[category]; const active = settings.categories.includes(category);
      return <button key={category} className={`category ${active ? 'is-active' : ''} ${category === 'nsfw' ? 'is-nsfw' : ''}`} onClick={() => toggleCategory(category)} aria-pressed={active}><span className="category-icon">{meta.icon}</span><span><strong>{meta.name}</strong><small>{meta.note}</small></span><span className="check">✓</span></button>;
    })}</div></> : <div className="custom-words"><label>平民词<input maxLength={20} value={civilianWord} onChange={(event) => setCivilianWord(event.target.value)} placeholder="例如：咖啡" /></label><label>卧底词<input maxLength={20} value={undercoverWord} onChange={(event) => setUndercoverWord(event.target.value)} placeholder="例如：奶茶" /></label></div>}
    <button className="deal-button" disabled={!canDeal} onClick={() => onDeal(settings.mode === 'custom' ? { civilianWord: normalizedCivilianWord, undercoverWord: normalizedUndercoverWord } : {})}><span>{settings.hasDealt ? '重新洗牌并发牌' : '洗牌并发牌'}</span><small>{settings.playerCount < 3 ? `还差 ${3 - settings.playerCount} 名收牌玩家` : settings.mode === 'custom' && !customWordsValid ? '请填写两个不同的词语' : `${settings.playerCount} 人收牌 · ${undercoverCount(settings.playerCount)} 名卧底`}</small></button>
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
  const [shareCards, setShareCards] = useState<ShareCard[]>([]);
  const [openShareCard, setOpenShareCard] = useState<number | null>(null);
  const [manageShareCard, setManageShareCard] = useState<number | null>(null);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
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
    if ('categories' in change) void parti.action('settings:setCategories', { categories: change.categories });
  }
  function changeShareDealSettings(change: DealSettingsChange) {
    if ('categories' in change) setShareCategories(change.categories);
    if ('playerCount' in change) setSharePlayerCount(change.playerCount);
    setShareCards([]); setShareResult(null);
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
    const dealt = dealCards(ids, pair, Math.random);
    setShareCards(ids.map((id) => ({ number: Number(id), word: dealt[id].word, role: dealt[id].role, seen: false, eliminated: false })));
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
    const cards = Object.fromEntries(nextCards.map((item) => [String(item.number), { role: item.role, word: item.word }]));
    const eliminatedIds = nextCards.filter((item) => item.eliminated).map((item) => String(item.number));
    const result = resolveElimination(cards, eliminatedIds);
    setShareCards(nextCards);
    setManageShareCard(null);
    if (result.finished && result.revealedWords) setShareResult(result.revealedWords);
  }

  const openShare = shareCards.find((item) => item.number === openShareCard);
  const managedShare = shareCards.find((item) => item.number === manageShareCard);
  const dealTableSettings: DealSettings = appMode === 'share'
    ? { mode: 'classic', categories: shareCategories, playerCount: sharePlayerCount, hasDealt: shareCards.length > 0 }
    : { mode: state?.selectedMode ?? 'classic', categories: state?.selectedCategories ?? ['entertainment', 'daily'], playerCount: participantCount, hasDealt: Boolean(state?.round) };
  const dealTableModes: DealMode[] = appMode === 'share' ? ['classic'] : ['classic', 'blank', 'custom'];
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
        {shareResult ? <div className="share-result"><p className="eyebrow">ALL UNDERCOVERS ELIMINATED</p><h3>所有卧底已出局</h3><div><span><small>平民牌</small><strong>{shareResult.civilian}</strong></span><i>VS</i><span><small>卧底牌</small><strong>{shareResult.undercover || '空白牌'}</strong></span></div><p>点击左侧按钮重新洗牌，开启下一轮。</p></div> : shareCards.length ? <div className="card-grid">{shareCards.map((item) => <button key={item.number} className={`number-card ${item.seen ? 'is-seen' : ''} ${item.eliminated ? 'is-eliminated' : ''}`} onClick={() => selectShareCard(item)} disabled={item.eliminated}><small>{item.eliminated ? '已出局' : item.seen ? '已看过' : '未查看'}</small><strong>{item.number}</strong><span>{item.eliminated ? '×' : item.seen ? '点击操作' : '点击翻牌'}</span></button>)}</div> : <div className="empty-deck"><span>✦</span><p>选择人数与牌盒分类，然后发牌</p></div>}
      </div>
    </section> : <section className="online-layout">
      <article className={`secret-card ${revealed ? 'is-revealed' : ''}`}>
        {card && hasCurrentCard && revealed ? <><p className="card-kicker">你的词语</p><div className={`secret-word ${card.word ? '' : 'is-blank'}`}>{card.word || '空白牌'}</div><p>{card.word ? '记住它，然后把牌藏好。' : '这张牌没有词语，请自由发挥。'}</p><button className="card-action ghost" onClick={() => setRevealed(false)}>我记住了</button></>
        : hasCurrentCard ? <><div className="sealed-icon">✦</div><h2>你的牌已送达</h2><p>确认没人偷看，再翻开牌面。</p><button className="card-action" onClick={() => setRevealed(true)}>查看我的词牌</button></>
        : <><div className="waiting-orbit"><span /></div><h2>{state?.phase === 'waiting' ? '牌桌准备中' : '等待下一轮'}</h2><p>房主发牌后，你的秘密词语只会出现在这里。</p></>}
      </article>
      <aside className="table-panel panel">
        <div className="section-heading"><div><p className="eyebrow">AT THE TABLE</p><h2>在场玩家</h2></div><b>{state?.players.length ?? 0}/12</b></div>
        <ul className="roster">{state?.players.map((player, index) => <li key={player.id}><span className={`avatar avatar-${index % 5}`}>{player.name.slice(0, 1)}</span><span className="player-name">{player.name}{player.id === playerId && <small>你</small>}</span>{state.eliminatedPlayerIds.includes(player.id) ? <em>已出局</em> : player.role === 'host' ? <em>房主</em> : state.dealtPlayerIds.includes(player.id) ? <i>●</i> : null}</li>)}</ul>
        <div className="table-actions">
          {isHost && <button className="host-button" onClick={() => setDealTableOpen(true)}>发牌台 <span>›</span></button>}
          {hasCurrentCard && <button className="eliminate-button" disabled={!canEliminateSelf} onClick={() => setEliminateModalOpen(true)}>{isEliminated ? '已出局' : '我被投出局了'}</button>}
        </div>
        {state?.phase === 'finished' && state.revealedWords && <div className="round-result"><small>本轮揭晓</small><strong>{state.revealedWords.civilian} <i>VS</i> {state.revealedWords.undercover || '空白牌'}</strong></div>}
      </aside>
    </section>}

    {dealTableOpen && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDealTableOpen(false)}><section className="modal host-modal" role="dialog" aria-modal="true" aria-labelledby="deal-table-title">
      <div className="modal-head"><div><p className="eyebrow">DEAL TABLE</p><h2 id="deal-table-title">发牌台</h2></div><button className="close-button" onClick={() => setDealTableOpen(false)}>×</button></div>
      <DealTable settings={dealTableSettings} modes={dealTableModes} playerCountRange={dealTablePlayerRange} notice={appMode === 'online' ? state?.notice : null} onChange={changeDealSettings} onDeal={submitDeal} />
    </section></div>}

    {eliminateModalOpen && <div className="modal-backdrop"><section className="modal confirm-modal" role="dialog" aria-modal="true"><div className="modal-icon">?</div><h2>确认已经被投出局？</h2><p>确认后本轮不能撤销，你的阵营仍然保密。</p><div className="modal-actions"><button onClick={() => setEliminateModalOpen(false)}>取消</button><button className="danger" onClick={() => { setEliminateModalOpen(false); void parti.action('round:eliminateSelf'); }}>确认出局</button></div></section></div>}
    {openShare && <div className="modal-backdrop"><section className="modal share-card-modal" role="dialog" aria-modal="true" aria-labelledby="share-word"><span className="share-number">玩家 {openShare.number}</span><p>你的词语</p><strong id="share-word">{openShare.word}</strong><small>记住序号和词语，不要让别人看到</small><button className="deal-button" onClick={rememberShareCard}><span>我记住了</span></button></section></div>}
    {managedShare && <div className="modal-backdrop"><section className="modal share-action-modal" role="dialog" aria-modal="true" aria-labelledby="share-action-title"><span className="share-number">玩家 {managedShare.number}</span><h2 id="share-action-title">这张牌怎么了？</h2><p>重新查看会再次展示秘密词语；确认出局后不能撤销。</p><div className="share-action-buttons"><button onClick={() => { setManageShareCard(null); setOpenShareCard(managedShare.number); }}>忘了，再看一次</button><button className="danger" onClick={eliminateShareCard}>被投出局了</button></div><button className="text-button" onClick={() => setManageShareCard(null)}>取消</button></section></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
