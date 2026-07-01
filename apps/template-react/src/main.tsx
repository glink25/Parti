import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import orbitUrl from './orbit.svg';
import './styles.css';

type DemoData = {
  message: string;
  source: string;
};

type CounterState = {
  count: number;
  clicks: Record<string, number>;
};

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? 'status status--ok' : 'status status--pending'}>
      <span aria-hidden="true">{ok ? '✓' : '…'}</span>
      <span>{children}</span>
    </li>
  );
}

function App() {
  const [data, setData] = useState<DemoData | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [counterState, setCounterState] = useState<CounterState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [flash, setFlash] = useState('');
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('./demo-data.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<DemoData>;
      })
      .then(setData)
      .catch((error: unknown) => {
        setFetchError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    const offState = parti.onState((state) => {
      setCounterState(state as CounterState);
      setPlayerId(parti.playerId);
    });

    const offEvent = parti.onEvent('counter:incremented', (payload) => {
      const { count } = payload as { count: number };
      setFlash(`计数 → ${count}`);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(''), 600);
    });

    parti.ready();

    return () => {
      offState();
      offEvent();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const clicks = counterState?.clicks ?? {};

  return (
    <main className="shell">
      <section className="card">
        <div className="hero">
          <img src={orbitUrl} alt="Parti orbit asset" />
          <div>
            <p className="eyebrow">PARTI PACKAGE · FILESYSTEM</p>
            <h1>React 模板加载成功</h1>
            <p>这个页面由 Vite 构建，并完全通过 package 内的相对路径加载。</p>
          </div>
        </div>

        <ul className="statuses">
          <Status ok>ES module 与 React 已执行</Status>
          <Status ok>CSS 与相对 SVG asset 已加载</Status>
          <Status ok={data !== null}>
            {data ? `${data.message}（${data.source}）` : fetchError || '正在通过相对路径 fetch JSON'}
          </Status>
        </ul>

        <section className="counter" aria-label="多人计数器">
          <h2 className="counter__title">多人计数器</h2>
          <p className="counter__me">
            你是 <strong>{playerId ?? '…'}</strong>
          </p>

          <div className="counter__count">{counterState?.count ?? 0}</div>

          <button
            type="button"
            className="counter__btn"
            onClick={() => parti.action('increment')}
          >
            +1
          </button>

          <h3 className="counter__subtitle">各玩家点击次数</h3>
          <ul className="counter__clicks">
            {Object.entries(clicks).map(([id, n]) => (
              <li key={id}>
                {id.slice(0, 12)}
                {id === playerId ? '（你）' : ''}: {n}
              </li>
            ))}
          </ul>

          <p className="counter__flash" aria-live="polite">
            {flash}
          </p>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
