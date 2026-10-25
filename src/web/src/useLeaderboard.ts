import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildLeaderboardUrl,
  PAGE_SIZE,
  type LeaderboardFilters,
  type SortBy,
  type StudentStat,
} from "./api";

/** Load this many rows on scroll, then let the reader ask for more. */
export const AUTO_LOAD_LIMIT = 200;

interface LeaderboardResult {
  stats: StudentStat[];
  total: number;
  /** When the numbers were last written, from page 1 (ISO-ish UTC). */
  updatedAt: string | null;
  /** Sections that actually exist for the current year/branch. */
  sections: string[] | null;
  loading: boolean;
  /** True while the first page for the current query is in flight. */
  initialLoading: boolean;
  /** A failed first page: the register could not open at all. */
  error: boolean;
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
 * `initialLoading` is true for every fresh query (not just the first ever),
 * so a sort or filter change shows skeletons instead of a blank page.
 */
export const useLeaderboard = (
  sortBy: SortBy,
  filters: LeaderboardFilters,
  search: string,
): LeaderboardResult => {
  const [stats, setStats] = useState<StudentStat[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [total, setTotal] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
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
      setMoreErrorBoth(false);
    }

    try {
      const response = await fetch(
        buildLeaderboardUrl(pageNum, sort, filters, search),
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("API error");

      const data = await response.json();
      const payload = Array.isArray(data.data)
        ? { rows: data.data, total: data.total }
        : data.data;

      const rows: StudentStat[] = payload?.rows ?? [];
      const nextTotal = Number(payload?.total ?? data.total ?? 0);
      setTotal(nextTotal);

      // page 1 is the only one that carries these
      if (data.updated_at != null) setUpdatedAt(String(data.updated_at));
      if (Array.isArray(data.facets?.sections)) {
        setSections(data.facets.sections.map(String));
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
      console.error("Failed to fetch leaderboard", err);
      if (pageNum === 1) {
        setError(true);
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
      }
    }
  };

  // reset + refetch when the query changes; skeletons cover the swap
  useEffect(() => {
    setPage(1);
    setStats([]);
    loadedCountRef.current = 0;
    setHasMoreBoth(true);
    setMoreErrorBoth(false);
    setInitialLoading(true);
    fetchLeaderboard(1, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, filters, search]);

  useEffect(() => {
    if (page > 1) {
      fetchLeaderboard(page, sortBy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || moreErrorRef.current || !hasMoreRef.current) {
      return;
    }
    setPage((prev) => prev + 1);
  }, []);

  const retry = useCallback(() => {
    setError(false);
    setStats([]);
    loadedCountRef.current = 0;
    setHasMoreBoth(true);
    setInitialLoading(true);
    setPage(1);
    fetchLeaderboard(1, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  const retryMore = useCallback(() => {
    setMoreErrorBoth(false);
    fetchLeaderboard(page, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortBy]);

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
    sections,
    loading,
    initialLoading,
    error,
    moreError,
    hasMore,
    retry,
    retryMore,
    loadMore,
    lastElementRef,
  };
};
