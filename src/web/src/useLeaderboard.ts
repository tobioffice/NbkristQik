import { useCallback, useEffect, useRef, useState } from "react";
import {
  authHeaders,
  buildLeaderboardUrl,
  PAGE_SIZE,
  type LeaderboardCoverage,
  type LeaderboardFilters,
  type LeaderboardFreshness,
  type LeaderboardScope,
  type LeaderboardScopeInfo,
  type SortBy,
  type StudentStat,
} from "./api";
import { RequestError, fetchWithTimeout, readJson } from "./http";

/** Load this many rows on scroll, then let the reader ask for more. */
export const AUTO_LOAD_LIMIT = 200;

/**
 * One character is not a query. Treating it as empty keeps the register
 * unfiltered while the reader types the first letter of a roll, instead of
 * sending a request the API rejects.
 */
export const searchQuery = (raw: string): string => {
  const clean = raw.trim();
  return clean.length >= 2 ? clean : "";
};

/** Page-1 extras are optional and may be absent on an older deployment. */
const parseCoverage = (raw: unknown): LeaderboardCoverage | null => {
  if (!raw || typeof raw !== "object") return null;
  const { ranked, known } = raw as Partial<LeaderboardCoverage>;
  if (typeof ranked !== "number" || typeof known !== "number") return null;
  return { ranked, known };
};

const parseFreshness = (raw: unknown): LeaderboardFreshness | null => {
  if (!raw || typeof raw !== "object") return null;
  const { newest, oldest } = raw as Partial<LeaderboardFreshness>;
  return {
    newest: typeof newest === "string" ? newest : null,
    oldest: typeof oldest === "string" ? oldest : null,
  };
};

const parseScope = (raw: unknown): LeaderboardScopeInfo | null => {
  if (!raw || typeof raw !== "object") return null;
  const { year, branch, section } = raw as Partial<LeaderboardScopeInfo>;
  return {
    year: typeof year === "string" ? year : null,
    branch: typeof branch === "string" ? branch : null,
    section: typeof section === "string" ? section : null,
  };
};

interface LeaderboardResult {
  stats: StudentStat[];
  total: number;
  /** When the numbers were last written, from page 1 (ISO-ish UTC). */
  updatedAt: string | null;
  /** Ranked vs. known students for this view, from page 1. */
  coverage: LeaderboardCoverage | null;
  /** The newest and oldest write behind the current view, from page 1. */
  freshness: LeaderboardFreshness | null;
  /** The year/branch/section the server actually resolved. */
  scope: LeaderboardScopeInfo | null;
  /** Sections that actually exist for the current year/branch. */
  sections: string[] | null;
  loading: boolean;
  /** True while the first page for the current query is in flight. */
  initialLoading: boolean;
  /**
   * A new query is loading while the previous rows stay on the sheet. They
   * are dimmed rather than replaced by skeletons.
   */
  refreshing: boolean;
  /** A failed first page: the register could not open at all. */
  error: boolean;
  /** The server's own sentence for that failure, when it gave one. */
  errorMessage: string | null;
  /** A failed later page: keep what is already on the sheet. */
  moreError: boolean;
  hasMore: boolean;
  retry: () => void;
  retryMore: () => void;
  loadMore: () => void;
  lastElementRef: (node: HTMLLIElement) => void;
}

/**
 * Data layer for the register: pages in as the reader scrolls, aborts
 * superseded requests, and keeps a failed page from wiping the sheet.
 *
 * A fresh query keeps the rows already on the sheet while its first page
 * loads (`refreshing`), so a filter change does not flash an empty page.
 * Skeletons are only for the first load, or when there is nothing to keep.
 *
 * The signed identity rides on every page request, not just the first: the
 * server names rows only for a verified caller. The hook still aborts
 * superseded requests itself, with the same 15s ceiling as the wrapper.
 */
export const useLeaderboard = (
  sortBy: SortBy,
  filters: LeaderboardFilters,
  scope: LeaderboardScope,
  search: string,
  initData?: string,
  enabled = true,
): LeaderboardResult => {
  const [stats, setStats] = useState<StudentStat[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [total, setTotal] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<LeaderboardCoverage | null>(null);
  const [freshness, setFreshness] = useState<LeaderboardFreshness | null>(
    null,
  );
  const [scopeInfo, setScopeInfo] = useState<LeaderboardScopeInfo | null>(null);
  const [sections, setSections] = useState<string[] | null>(null);

  const observer = useRef<IntersectionObserver | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const loadedCountRef = useRef(0);
  const hasMoreRef = useRef(true);
  const moreErrorRef = useRef(false);
  const loadingRef = useRef(false);

  const setHasMoreBoth = (next: boolean) => {
    hasMoreRef.current = next;
    setHasMore(next);
  };

  const setMoreErrorBoth = (next: boolean) => {
    moreErrorRef.current = next;
    setMoreError(next);
  };

  const fetchLeaderboard = async (pageNum: number, sort: SortBy) => {
    // a second "load more" must not ride on top of the first; a fresh query
    // (page 1) is allowed to supersede whatever is in flight
    if (inFlightRef.current && pageNum !== 1) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqId = ++reqIdRef.current;
    const timeout = setTimeout(() => controller.abort(), 15000);

    inFlightRef.current = true;
    loadingRef.current = true;
    setLoading(true);
    if (pageNum === 1) {
      setError(false);
      setErrorMessage(null);
      setMoreErrorBoth(false);
    }

    try {
      const response = await fetchWithTimeout(
        buildLeaderboardUrl(
          pageNum,
          sort,
          filters,
          searchQuery(search),
          scope,
        ),
        {
          signal: controller.signal,
          headers: authHeaders(initData),
        },
      );
      // readJson throws a RequestError carrying the server's sentence, so a
      // validation message is shown as written instead of "API error".
      const data = await readJson<{
        data?: StudentStat[] | { rows?: StudentStat[]; total?: number };
        total?: number;
        updated_at?: string | null;
        facets?: { sections?: string[] } | null;
        coverage?: Partial<LeaderboardCoverage> | null;
        freshness?: Partial<LeaderboardFreshness> | null;
        scope?: Partial<LeaderboardScopeInfo> | null;
      }>(response);
      const payload = Array.isArray(data.data)
        ? { rows: data.data, total: data.total }
        : data.data;

      const rows: StudentStat[] = payload?.rows ?? [];
      const nextTotal = Number(payload?.total ?? data.total ?? 0);
      setTotal(nextTotal);
      setError(false);
      setErrorMessage(null);

      // page 1 is the only one that carries these; later pages return null
      // for freshness/coverage, so leaving the state alone keeps the head
      // of the sheet honest
      if (pageNum === 1) {
        setUpdatedAt(
          data.updated_at != null ? String(data.updated_at) : null,
        );
        setCoverage(parseCoverage(data.coverage));
        setFreshness(parseFreshness(data.freshness));
        setScopeInfo(parseScope(data.scope));
        if (Array.isArray(data.facets?.sections)) {
          setSections(data.facets.sections.map(String));
        }
      }

      const loaded =
        pageNum === 1 ? rows.length : loadedCountRef.current + rows.length;
      loadedCountRef.current = loaded;
      setStats((prev) => (pageNum === 1 ? rows : [...prev, ...rows]));

      // stop at the true end even if the last page happened to be full
      const bounded = nextTotal > 0 ? loaded < nextTotal : true;
      setHasMoreBoth(rows.length >= PAGE_SIZE && bounded);
    } catch (err) {
      // a superseded request must not paint an error over the new one
      if (reqId !== reqIdRef.current) return;
      // an abort is the caller moving on, not a failure to report
      if ((err as Error)?.name === "AbortError") return;

      console.error("Failed to fetch leaderboard", err);
      if (pageNum === 1) {
        setError(true);
        // the old rows may still be on screen, but they belong to the
        // previous query: do not offer page 2 of the new one until retry
        setErrorMessage(
          err instanceof RequestError && err.message ? err.message : null,
        );
        setHasMoreBoth(false);
      } else {
        // keep the rows already read; offer a retry in the footer
        setMoreErrorBoth(true);
        setHasMoreBoth(true);
      }
    } finally {
      if (reqId === reqIdRef.current) {
        clearTimeout(timeout);
        inFlightRef.current = false;
        loadingRef.current = false;
        setLoading(false);
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  };

  // Refetch when the query changes. The rows already on the sheet stay put
  // (dimmed via `refreshing`); skeletons only cover a first or empty load.
  useEffect(() => {
    // A cold deep link must not fetch the whole register while `/api/me` is
    // still deciding whether the caller has a section. Keep the skeleton until
    // the identity answers, then make the one correct request.
    if (!enabled) return;

    const keepRows = loadedCountRef.current > 0;
    setPage(1);
    setHasMoreBoth(true);
    setMoreErrorBoth(false);
    setInitialLoading(!keepRows);
    setRefreshing(keepRows);
    fetchLeaderboard(1, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, filters, scope, search, initData, enabled]);

  useEffect(() => {
    if (enabled && page > 1) {
      fetchLeaderboard(page, sortBy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, enabled]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || moreErrorRef.current || !hasMoreRef.current) {
      return;
    }
    setPage((prev) => prev + 1);
  }, []);

  const retry = useCallback(() => {
    const keepRows = loadedCountRef.current > 0;
    setError(false);
    setErrorMessage(null);
    setMoreErrorBoth(false);
    setHasMoreBoth(true);
    setInitialLoading(!keepRows);
    setRefreshing(keepRows);
    setPage(1);
    fetchLeaderboard(1, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, filters, scope, search, initData]);

  const retryMore = useCallback(() => {
    setMoreErrorBoth(false);
    fetchLeaderboard(page, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortBy, filters, scope, search, initData]);

  const lastElementRef = useCallback(
    (node: HTMLLIElement) => {
      observer.current?.disconnect();
      if (!node || typeof IntersectionObserver === "undefined") return;

      observer.current = new IntersectionObserver(
        (entries) => {
          if (
            entries[0]?.isIntersecting &&
            loadedCountRef.current < AUTO_LOAD_LIMIT
          ) {
            loadMore();
          }
        },
        { rootMargin: "200px 0px" },
      );
      observer.current.observe(node);
    },
    [loadMore],
  );

  return {
    stats,
    total,
    updatedAt,
    coverage,
    freshness,
    scope: scopeInfo,
    sections,
    loading,
    initialLoading,
    refreshing,
    error,
    errorMessage,
    moreError,
    hasMore,
    retry,
    retryMore,
    loadMore,
    lastElementRef,
  };
};
