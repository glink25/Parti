import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IntlProvider, useIntl } from 'react-intl';
import { detectLocale, LOCALE_STORAGE_KEY, type AppLocale } from './locales.js';
import { messagesByLocale } from './messages.js';

interface LocaleContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function DocumentLocaleSync() {
  const { locale } = useLocale();
  const intl = useIntl();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = intl.formatMessage({ id: 'app.documentTitle' });
  }, [intl, locale]);

  return null;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(detectLocale);

  const setLocale = (next: AppLocale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const contextValue = useMemo(() => ({ locale, setLocale }), [locale]);
  const messages = messagesByLocale[locale];

  return (
    <LocaleContext.Provider value={contextValue}>
      <IntlProvider locale={locale} messages={messages} defaultLocale="zh-CN">
        <DocumentLocaleSync />
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used within LocaleProvider');
  return value;
}

export { getRandomNamePools, rawMessagesByLocale } from './messages.js';
