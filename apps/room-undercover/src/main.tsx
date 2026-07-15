import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CATEGORIES = ['entertainment', 'weapons', 'daily', 'nsfw'] as const;
type Category = typeof CATEGORIES[number];
type DealMode = 'classic' | 'blank' | 'custom';
type Card = { word: string };

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
  revealedWords: { civilian: string; undercover: string } | null;
  notice: string | null;
};
type PrivateCard = Card & { round: number };

const CATEGORY_LABELS: Record<Category, { icon: string; name: string; note: string }> = {
  entertainment: { icon: '✦', name: '娱乐', note: '影视 · 音乐 · 游戏' },
  weapons: { icon: '⚔', name: '武器', note: '古今装备与防具' },
  daily: { icon: '⌂', name: '日常', note: '生活里的相似事物' },
  nsfw: { icon: '♥', name: 'NSFW', note: '含蓄成人向 · 18+' },
};

const MODE_LABELS: Record<DealMode, { icon: string; name: string; note: string }> = {
  classic: { icon: '双', name: '经典词库', note: '房主一起参与' },
  blank: { icon: '□', name: '空白牌', note: '房主担任主持' },
  custom: { icon: '笔', name: '自定义', note: '房主填写词语' },
};

function App() {
  const [state, setState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [card, setCard] = useState<PrivateCard | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [eliminateModalOpen, setEliminateModalOpen] = useState(false);
  const [customCivilianWord, setCustomCivilianWord] = useState('');
  const [customUndercoverWord, setCustomUndercoverWord] = useState('');
  const eliminateButtonRef = useRef<HTMLButtonElement>(null);
  const confirmEliminateRef = useRef<HTMLButtonElement>(null);
  const eliminateModalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const offState = parti.onState((nextState) => {
      const roomState = nextState as RoomState;
      setState(roomState);
      setPlayerId(parti.playerId);
      setCard((current) => current?.round === roomState.round ? current : null);
      setRevealed(false);
    });
    const offCard = parti.onEvent('undercover:card', (payload) => {
      setCard(payload as PrivateCard);
      setRevealed(false);
    });
    parti.ready();
    return () => {
      offState();
      offCard();
    };
  }, []);

  useEffect(() => {
    if (!eliminateModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEliminateModalOpen(false);
      if (event.key === 'Tab') {
        const focusable = eliminateModalRef.current?.querySelectorAll<HTMLButtonElement>('button');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    confirmEliminateRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      eliminateButtonRef.current?.focus();
    };
  }, [eliminateModalOpen]);

  const isHost = Boolean(playerId && state?.hostId === playerId);
  const me = state?.players.find((player) => player.id === playerId);
  const hasCurrentCard = Boolean(card && state && card.round === state.round);
  const joinedAfterDeal = Boolean(
    state && state.phase !== 'waiting' && playerId && !state.dealtPlayerIds.includes(playerId),
  );
  const isEliminated = Boolean(playerId && state?.eliminatedPlayerIds.includes(playerId));
  const canEliminateSelf = Boolean(
    state?.phase === 'active' && playerId && state.dealtPlayerIds.includes(playerId) && !isEliminated,
  );
  const playerCount = state?.players.length ?? 0;
  const participantCount = state
    ? state.players.filter((player) => state.selectedMode === 'classic' || player.role !== 'host').length
    : 0;
  const undercoverTotal = participantCount < 3 ? 0 : participantCount <= 5 ? 1 : participantCount <= 9 ? 2 : 3;
  const normalizedCivilianWord = customCivilianWord.trim();
  const normalizedUndercoverWord = customUndercoverWord.trim();
  const customWordsValid = normalizedCivilianWord.length > 0
    && normalizedUndercoverWord.length > 0
    && normalizedCivilianWord !== normalizedUndercoverWord
    && normalizedCivilianWord.length <= 20
    && normalizedUndercoverWord.length <= 20;
  const canDeal = participantCount >= 3 && (state?.selectedMode !== 'custom' || customWordsValid);

  const selectedSummary = useMemo(() =>
    state?.selectedCategories.map((category) => CATEGORY_LABELS[category].name).join(' · ') ?? '—',
  [state?.selectedCategories]);

  function toggleCategory(category: Category) {
    if (!state || !isHost) return;
    const selected = state.selectedCategories.includes(category);
    const next = selected
      ? state.selectedCategories.filter((item) => item !== category)
      : [...state.selectedCategories, category];
    if (next.length === 0) return;
    void parti.action('settings:setCategories', { categories: next });
  }

  function selectMode(mode: DealMode) {
    if (!isHost) return;
    void parti.action('settings:setMode', { mode });
  }

  function dealRound() {
    if (state?.selectedMode === 'custom') {
      void parti.action('round:deal', {
        civilianWord: normalizedCivilianWord,
        undercoverWord: normalizedUndercoverWord,
      });
      return;
    }
    void parti.action('round:deal');
  }

  function confirmElimination() {
    setEliminateModalOpen(false);
    void parti.action('round:eliminateSelf');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">卧</div>
        <div>
          <p className="eyebrow">PARTI PARTY DECK</p>
          <h1>谁是卧底</h1>
          <p className="subtitle">只管发牌，剩下的交给你们。</p>
        </div>
        <div className="round-chip">第 {state?.round ?? 0} 轮</div>
      </header>

      <div className="layout">
        <section className="main-column">
          <article className={`secret-card ${revealed ? 'secret-card--revealed' : ''}`}>
            <div className="card-noise" />
            {card && hasCurrentCard && revealed ? (
              <>
                <p className="card-kicker">你的词语</p>
                <div className={`secret-word ${card.word ? '' : 'secret-word--blank'}`}>{card.word || '空白牌'}</div>
                <p className="card-tip">{card.word ? '记住它，然后把牌藏好。' : '这张牌没有词语，请自由发挥。'}</p>
                <button className="card-action card-action--ghost" onClick={() => setRevealed(false)}>
                  隐藏我的牌
                </button>
              </>
            ) : hasCurrentCard ? (
              <>
                <div className="sealed-icon" aria-hidden="true">✦</div>
                <h2>你的牌已送达</h2>
                <p>确认没人偷看，再翻开牌面。</p>
                <button className="card-action" onClick={() => setRevealed(true)}>按住秘密 · 查看词牌</button>
              </>
            ) : (
              <>
                <div className="waiting-orbit" aria-hidden="true"><span /></div>
                <h2>{joinedAfterDeal ? '等待下一轮' : state?.phase !== 'waiting' ? '正在接收词牌' : '牌桌准备中'}</h2>
                <p>{joinedAfterDeal ? '这一轮已经发牌，你会自动加入房主的下一次发牌。' : '房主发牌后，你的秘密词语只会出现在这里。'}</p>
              </>
            )}
          </article>

          {hasCurrentCard && state && state.phase !== 'waiting' && (
            <section className="elimination-panel">
              <div>
                <p className="eyebrow">PLAYER STATUS</p>
                <h2>{isEliminated ? '你已出局' : state.phase === 'finished' ? '本轮已经结束' : '被大家投出局了吗？'}</h2>
                <p>{isEliminated ? '你的阵营仍然保密，可以继续围观讨论。' : '只有确认自己已被投出局后再点击。'}</p>
              </div>
              <button
                ref={eliminateButtonRef}
                className="eliminate-button"
                disabled={!canEliminateSelf}
                onClick={() => setEliminateModalOpen(true)}
              >
                {isEliminated ? '你已出局' : '我被投出局了'}
              </button>
            </section>
          )}

          {state?.phase === 'finished' && state.revealedWords && (
            <section className="reveal-panel" aria-live="polite">
              <p className="eyebrow">ROUND REVEAL</p>
              <h2>所有卧底已出局</h2>
              <div className="revealed-words">
                <div><small>平民牌</small><strong>{state.revealedWords.civilian}</strong></div>
                <span aria-hidden="true">VS</span>
                <div><small>卧底牌</small><strong>{state.revealedWords.undercover || '空白牌'}</strong></div>
              </div>
              <p>房主可以随时重新发牌，开启下一场。</p>
            </section>
          )}

          {isHost && (
            <section className="host-panel">
              <div className="section-heading">
                <div><p className="eyebrow">HOST CONTROLS</p><h2>房主发牌台</h2></div>
                <span>{MODE_LABELS[state?.selectedMode ?? 'classic'].name}</span>
              </div>
              <div className="mode-grid">
                {(Object.keys(MODE_LABELS) as DealMode[]).map((mode) => {
                  const meta = MODE_LABELS[mode];
                  const active = state?.selectedMode === mode;
                  return (
                    <button
                      key={mode}
                      className={`mode-card ${active ? 'mode-card--active' : ''}`}
                      onClick={() => selectMode(mode)}
                      aria-pressed={active}
                    >
                      <span>{meta.icon}</span><strong>{meta.name}</strong><small>{meta.note}</small>
                    </button>
                  );
                })}
              </div>

              {state?.selectedMode !== 'custom' ? (
                <>
                  {state?.selectedMode === 'blank' && <p className="moderator-note">房主本轮只负责主持，不会收到词牌。</p>}
                  <div className="section-heading category-heading"><h3>选择词牌分类</h3><span>{selectedSummary}</span></div>
                  <div className="category-grid">
                    {CATEGORIES.map((category) => {
                      const meta = CATEGORY_LABELS[category];
                      const active = state?.selectedCategories.includes(category);
                      return (
                        <button
                          key={category}
                          className={`category ${active ? 'category--active' : ''} ${category === 'nsfw' ? 'category--nsfw' : ''}`}
                          onClick={() => toggleCategory(category)}
                          aria-pressed={active}
                        >
                          <span className="category-icon">{meta.icon}</span>
                          <span><strong>{meta.name}</strong><small>{meta.note}</small></span>
                          <span className="check">✓</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="custom-words">
                  <p className="moderator-note">房主本轮只负责主持。自定义词语不会在发牌前同步给其他玩家。</p>
                  <label><span>平民词</span><input maxLength={20} value={customCivilianWord} onChange={(event) => setCustomCivilianWord(event.target.value)} placeholder="例如：咖啡" /></label>
                  <label><span>卧底词</span><input maxLength={20} value={customUndercoverWord} onChange={(event) => setCustomUndercoverWord(event.target.value)} placeholder="例如：奶茶" /></label>
                  {normalizedCivilianWord && normalizedCivilianWord === normalizedUndercoverWord && <p className="field-error">两个词语不能相同</p>}
                </div>
              )}
              <button
                className="deal-button"
                disabled={!canDeal}
                onClick={dealRound}
              >
                <span>{state?.round ? '重新洗牌并发牌' : '洗牌并发牌'}</span>
                <small>{participantCount < 3
                  ? `还差 ${3 - participantCount} 名收牌玩家`
                  : state?.selectedMode === 'custom' && !customWordsValid
                    ? '请填写两个不同的词语'
                    : `${participantCount} 人收牌 · ${undercoverTotal} 名卧底`}</small>
              </button>
              {state?.notice && <p className="notice" role="status">{state.notice}</p>}
            </section>
          )}
        </section>

        <aside className="sidebar">
          <section className="roster-panel">
            <div className="section-heading compact"><div><p className="eyebrow">AT THE TABLE</p><h2>在场玩家</h2></div><b>{playerCount}/12</b></div>
            <ul className="roster">
              {state?.players.map((player, index) => {
                const dealt = state.dealtPlayerIds.includes(player.id);
                return (
                  <li key={player.id}>
                    <span className={`avatar avatar-${index % 5}`}>{player.name.slice(0, 1).toUpperCase()}</span>
                    <span className="player-name">{player.name}{player.id === playerId && <small>你</small>}</span>
                    {state.eliminatedPlayerIds.includes(player.id)
                      ? <span className="eliminated-tag">已出局</span>
                      : player.role === 'host'
                        ? <span className="host-tag">{state.roundMode && state.roundMode !== 'classic' ? '主持' : '房主'}</span>
                        : state.phase !== 'waiting' && <span className={dealt ? 'ready-dot' : 'wait-tag'}>{dealt ? '●' : '等待'}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="rules-panel">
            <p className="eyebrow">QUICK RULES</p>
            <h2>发完就开聊</h2>
            <ol><li>所有人只知道自己的词，不知道阵营。</li><li>被投出局后，由本人在这里确认出局。</li><li>所有卧底出局后，系统会揭晓两张词牌。</li></ol>
          </section>
          <p className="me-line">当前身份：{me?.name ?? '正在加入…'}</p>
        </aside>
      </div>

      {eliminateModalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEliminateModalOpen(false);
          }}
        >
          <section ref={eliminateModalRef} className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="eliminate-title">
            <div className="modal-icon" aria-hidden="true">?</div>
            <p className="eyebrow">CONFIRM ELIMINATION</p>
            <h2 id="eliminate-title">确认你已经被投出局？</h2>
            <p>确认后本轮不能撤销。你的阵营不会向其他玩家公开。</p>
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setEliminateModalOpen(false)}>取消</button>
              <button ref={confirmEliminateRef} className="modal-confirm" onClick={confirmElimination}>确认出局</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
