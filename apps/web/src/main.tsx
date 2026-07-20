import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './i18n/LocaleProvider';
import './styles.css';
import { clearStalePackageCaches } from './lib/packageUiLoader';
import { ensureWebCryptoSubtle } from './polyfills';

const PRELOAD_RELOAD_AT_KEY = 'parti:preload-reload-at';
const PRELOAD_RELOAD_COOLDOWN_MS = 30_000;

function markPreloadReloadAttempt(): boolean {
  try {
    const now = Date.now();
    const previous = Number.parseInt(sessionStorage.getItem(PRELOAD_RELOAD_AT_KEY) ?? '', 10);
    if (Number.isFinite(previous) && previous <= now && now - previous < PRELOAD_RELOAD_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(PRELOAD_RELOAD_AT_KEY, String(now));
    return true;
  } catch {
    // Without session storage, a reload cannot be guarded against an infinite loop.
    return false;
  }
}

window.addEventListener('vite:preloadError', (event) => {
  if (!markPreloadReloadAttempt()) return;
  event.preventDefault();
  window.location.reload();
});

async function bootstrap(): Promise<void> {
  await ensureWebCryptoSubtle();
  await clearStalePackageCaches();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </StrictMode>,
  );
}

void bootstrap();
