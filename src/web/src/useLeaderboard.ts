import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildLeaderboardUrl,
  PAGE_SIZE,
  type LeaderboardFilters,
  type SortBy,
  type StudentStat,
} from "./api";

interface LeaderboardResult {
  stats: StudentStat[];
  total: number;
  loading: boolean;
  initialLoading: boolean;
  error: boolean;
  hasMore: boolean;
  retry: () => void;
  lastElementRef: (node: HTMLDivElement) => void;
}

/**
 * Infinite-scroll data layer for the leaderboard: fetches pages, aborts
 * superseded requests, tracks a stale-response guard (reqId).
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
  const [total, setTotal] = useState(0);

  const observer = useRef<IntersectionObserver | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  const fetchLeaderboard = async (pageNum: number, sort: SortBy) => {
    if (loading && pageNum !== 1) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqId = ++reqIdRef.current;
    const timeout = setTimeout(() => controller.abort(), 15000);

    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        buildLeaderboardUrl(pageNum, sort, filters, search),
        {
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("API error");

      const data = await response.json();
      const payload = Array.isArray(data.data)
        ? { rows: data.data, total: data.total }
        : data.data;
      setTotal(payload?.total ?? data.total ?? 0);

      const rows = payload?.rows ?? [];
      if (rows.length === 0) {
        setHasMore(false);
      } else {
        setStats((prev: StudentStat[]) =>
          pageNum === 1 ? rows : [...prev, ...rows],
        );
        setHasMore(rows.length >= PAGE_SIZE);
      }
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      if ((err as Error)?.name === "AbortError") {
        console.error("Leaderboard request timed out", err);
      } else {
        console.error("Failed to fetch leaderboard", err);
      }
      setError(true);
    } finally {
      // a superseded request must not touch shared loading state
      if (reqId === reqIdRef.current) {
        clearTimeout(timeout);
        setLoading(false);
        setInitialLoading(false);
      }
    }
  };

  // reset + refetch when the query changes (intentional setState-in-effect)
  useEffect(() => {
     
    setPage(1);
    setStats([]);
    setHasMore(true);
    fetchLeaderboard(1, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, filters, search]);

  useEffect(() => {
    if (page > 1) {
       
      fetchLeaderboard(page, sortBy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const lastElementRef = useCallback(
    (node: HTMLDivElement) => {
      if (loading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setPage((prev) => prev + 1);
        }
      });
      if (node) observer.current.observe(node);
    },
    [loading, hasMore],
  );

  const retry = () => {
    setPage(1);
    fetchLeaderboard(1, sortBy);
  };

  return {
    stats,
    total,
    loading,
    initialLoading,
    error,
    hasMore,
    retry,
    lastElementRef,
  };
};
