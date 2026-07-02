import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './i18n/LocaleProvider';
import './styles.css';
import { clearStalePackageCaches } from './lib/packageUiLoader';
import { ensureWebCryptoSubtle } from './polyfills';

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
