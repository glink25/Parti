import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { LocaleProvider } from './i18n/LocaleProvider.js';
import './styles.css';
import { clearStalePackageCaches } from './lib/packageUiLoader.js';
import { ensureWebCryptoSubtle } from './polyfills.js';

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
