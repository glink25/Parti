import './polyfills.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { LocaleProvider } from './i18n/LocaleProvider.js';
import './styles.css';
import { clearStalePackageCaches } from './lib/packageUiLoader.js';

async function bootstrap(): Promise<void> {
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
