/** 房间市场区块：展示 GitHub issue 注册表中上架的在线房间模版，支持一键安装与滚动分页加载。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { DownloadIcon, Loader2Icon, RefreshCwIcon, StoreIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatResolveError } from '@/i18n/formatErrors';
import {
  cacheMarketState,
  installMarketTemplate,
  listInstalledMarketRefs,
  listMarketTemplates,
  loadMarketPage,
  MARKET_DOCS_URL,
  type MarketError,
  type MarketTemplateEntry,
} from '@/lib/market';

interface MarketSectionProps {
  onInstalled: (templateId: string) => void;
  onError: (message: string) => void;
  /** 已加载的市场条目数变化时上报（用于分类 tab 计数）。 */
  onEntriesChange?: (count: number) => void;
}

interface MarketViewState {
  entries: MarketTemplateEntry[];
  nextPage: number;
  hasMore: boolean;
  stale: boolean;
  error?: MarketError;
}

function badgeClass(badge: string): string {
  return badge === 'recommend'
    ? 'bg-success/15 text-success'
    : 'bg-primary-bright/15 text-primary-bright';
}

export function MarketSection({ onInstalled, onError, onEntriesChange }: MarketSectionProps) {
  const intl = useIntl();
  const [state, setState] = useState<MarketViewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [installedRefs, setInstalledRefs] = useState<Set<string>>(new Set());
  const [installingRef, setInstallingRef] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setLoadMoreError(null);
    try {
      const result = await listMarketTemplates({ forceRefresh });
      setState({
        entries: result.entries,
        nextPage: result.nextPage,
        hasMore: result.hasMore,
        stale: result.stale,
        ...(result.error ? { error: result.error } : {}),
      });
      setInstalledRefs(await listInstalledMarketRefs());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    if (!current || !current.hasMore || loadingMoreRef.current) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const excludeRefs = new Set(current.entries.map((entry) => entry.ref));
      const page = await loadMarketPage(current.nextPage, excludeRefs);
      const merged = [...current.entries, ...page.entries];
      setState({ ...current, entries: merged, nextPage: page.nextPage, hasMore: page.hasMore, stale: false });
      cacheMarketState(merged, page.nextPage, page.hasMore);
    } catch (reason) {
      setLoadMoreError(formatResolveError(intl, reason));
    } finally {
      setLoadingMore(false);
    }
  }, [intl]);

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
      },
      { rootMargin: '240px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function install(entry: MarketTemplateEntry): Promise<void> {
    setInstallingRef(entry.ref);
    try {
      const id = await installMarketTemplate(entry);
      setInstalledRefs(await listInstalledMarketRefs());
      onInstalled(id);
    } catch (reason) {
      onError(formatResolveError(intl, reason));
    } finally {
      setInstallingRef(null);
    }
  }

  const entries = state?.entries ?? [];
  const registryFailed = Boolean(state?.error) && !state?.stale;

  const entryCount = entries.length;
  const onEntriesChangeRef = useRef(onEntriesChange);
  onEntriesChangeRef.current = onEntriesChange;
  useEffect(() => {
    onEntriesChangeRef.current?.(entryCount);
  }, [entryCount]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          <FormattedMessage id="editor.market.description" />{' '}
          <a
            className="text-primary-bright underline-offset-2 hover:underline"
            href={MARKET_DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            <FormattedMessage id="editor.market.publishGuide" />
          </a>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCwIcon data-icon="inline-start" className={cn(loading && 'animate-spin')} />
          {loading
            ? intl.formatMessage({ id: 'editor.market.refreshing' })
            : intl.formatMessage({ id: 'editor.market.refresh' })}
        </Button>
      </div>

      {state?.stale && (
        <div className="mb-3 rounded-[11px] border border-primary-bright/30 bg-primary-bright/10 px-3.5 py-3 text-xs text-foreground">
          <FormattedMessage id="editor.market.staleWarning" />
        </div>
      )}
      {registryFailed && (
        <div className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">
          {formatResolveError(intl, state?.error)}
        </div>
      )}

      {!loading && entries.length === 0 && !registryFailed ? (
        <div className="flex min-h-32 flex-col items-center justify-center rounded-[20px] border border-dashed border-border-strong bg-card/55 p-8 text-center">
          <StoreIcon className="mb-3 size-8 text-primary-bright/70" aria-hidden="true" />
          <b><FormattedMessage id="editor.market.emptyTitle" /></b>
          <p className="mt-1 text-sm text-muted-foreground"><FormattedMessage id="editor.market.emptyDescription" /></p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:gap-[18px]">
            {entries.map((entry) => {
              const installed = installedRefs.has(entry.ref);
              const installing = installingRef === entry.ref;
              const unavailable = Boolean(entry.manifestError);
              return (
                <div
                  key={entry.ref}
                  className="flex flex-col gap-2 rounded-[18px] border border-border bg-surface p-[18px] shadow-[0_10px_28px_rgba(91,72,15,0.07)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <b className="text-sm md:text-base">{entry.manifest?.name ?? entry.ref}</b>
                    {entry.badges.length > 0 && (
                      <span className="flex flex-none gap-1.5">
                        {entry.badges.map((badge) => (
                          <span
                            key={badge}
                            className={cn('rounded-full px-2.5 py-[3px] text-[10px] font-bold', badgeClass(badge))}
                          >
                            {intl.formatMessage({ id: `editor.market.badges.${badge}` })}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <small className="text-xs font-medium leading-[1.55] text-muted-foreground">
                    {entry.manifestError
                      ? intl.formatMessage({ id: `editor.market.${entry.manifestError === 'MANIFEST_INVALID' ? 'manifestInvalid' : 'manifestUnavailable'}` })
                      : entry.manifest?.description ?? ''}
                  </small>
                  <a
                    className="mt-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    href={entry.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.ref}
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={unavailable || installingRef !== null}
                    onClick={() => void install(entry)}
                  >
                    <DownloadIcon data-icon="inline-start" />
                    {installing
                      ? intl.formatMessage({ id: 'editor.market.installing' })
                      : installed
                        ? intl.formatMessage({ id: 'editor.market.reinstall' })
                        : intl.formatMessage({ id: 'editor.market.install' })}
                  </Button>
                </div>
              );
            })}
          </div>

          <div ref={sentinelRef} className="mt-4 flex min-h-6 items-center justify-center gap-2 text-xs text-muted-foreground">
            {loadingMore && (
              <>
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                <FormattedMessage id="editor.market.loadingMore" />
              </>
            )}
            {!loadingMore && loadMoreError && (
              <>
                <span className="text-destructive">{loadMoreError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()}>
                  <FormattedMessage id="editor.market.loadMoreRetry" />
                </Button>
              </>
            )}
            {!loadingMore && !loadMoreError && state && !state.hasMore && entries.length > 0 && (
              <FormattedMessage id="editor.market.allLoaded" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
