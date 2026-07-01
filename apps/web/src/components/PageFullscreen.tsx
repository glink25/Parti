import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type PageFullscreenContextValue = {
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
};

const PageFullscreenContext = createContext<PageFullscreenContextValue | null>(null);

export function PageFullscreenProvider({ children }: { children: ReactNode }) {
  const [fullscreen, setFullscreen] = useState(false);
  const value = useMemo(() => ({ fullscreen, setFullscreen }), [fullscreen]);

  useEffect(() => {
    document.body.classList.toggle('room-expanded', fullscreen);
    return () => document.body.classList.remove('room-expanded');
  }, [fullscreen]);

  return <PageFullscreenContext.Provider value={value}>{children}</PageFullscreenContext.Provider>;
}

export function usePageFullscreen(): PageFullscreenContextValue {
  const value = useContext(PageFullscreenContext);
  if (!value) throw new Error('usePageFullscreen must be used inside PageFullscreenProvider');
  return value;
}
