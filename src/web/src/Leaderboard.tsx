import { useEffect, useMemo, useState } from "react";
import type { SortBy } from "./api";
import { useLeaderboard } from "./useLeaderboard";
import { useTelegramUser } from "./useTelegramUser";
import SearchBar from "./components/SearchBar";
import SortTabs from "./components/SortTabs";
import FilterBar from "./components/FilterBar";
import Podium from "./components/Podium";
import StudentRow from "./components/StudentRow";
import {
  EmptyState,
  EndNote,
  ErrorState,
  LoadingSpinner,
  SkeletonRows,
} from "./components/FeedbackStates";

export default function Leaderboard() {
  const [sortBy, setSortBy] = useState<SortBy>("attendance");
  const [filterYear, setFilterYear] = useState("all");
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // stable identity so the fetch effect only fires on real filter changes
  const filters = useMemo(
    () => ({ year: filterYear, branch: filterBranch, section: filterSection }),
    [filterYear, filterBranch, filterSection],
  );

  // debounced search -> triggers refetch via hook deps
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const {
    stats,
    total,
    loading,
    initialLoading,
    error,
    hasMore,
    retry,
    lastElementRef,
  } = useLeaderboard(sortBy, filters, search);
  const { myRoll, myRank } = useTelegramUser();

  const myRankNow = myRoll
    ? sortBy === "attendance"
      ? myRank?.attendance
      : myRank?.midmarks
    : null;

  const isFiltered =
    search !== "" ||
    filterYear !== "all" ||
    filterBranch !== "all" ||
    filterSection !== "all";

  const podiumVisible = stats.length > 0 && !search;
  const listStats = search ? stats : stats.slice(3);

  return (
    <div className="min-h-screen font-['Outfit'] bg-[#0f1014] text-slate-200 selection:bg-indigo-500/30">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#0f1014] to-[#0f1014] pointer-events-none" />

      <div className="relative max-w-lg mx-auto p-4 md:p-6 pb-20">
        {/* Header */}
        <header className="mt-8 mb-6 text-center space-y-2">
          <h1 className="text-3xl font-bold text-white tracking-tight drop-shadow-sm">
            Leader
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
              board
            </span>
          </h1>
          {!initialLoading && total > 0 && !error && (
            <p className="text-xs text-slate-500">
              {total.toLocaleString()} student{total !== 1 ? "s" : ""}
            </p>
          )}
        </header>

        <SearchBar value={searchInput} onChange={setSearchInput} />

        {/* You are #N banner (global rank — only when unfiltered) */}
        {myRoll && myRankNow != null && !initialLoading && !error && !isFiltered && (
          <div className="flex items-center justify-center mb-4">
            <span className="text-xs font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-2">
              🎯 You're #{myRankNow} of {total.toLocaleString()} · {myRoll}
            </span>
          </div>
        )}

        <SortTabs sortBy={sortBy} onSortChange={setSortBy} />
        <FilterBar
          filters={filters}
          onChange={(patch) => {
            if (patch.year !== undefined) setFilterYear(patch.year);
            if (patch.branch !== undefined) setFilterBranch(patch.branch);
            if (patch.section !== undefined) setFilterSection(patch.section);
          }}
        />

        {podiumVisible && <Podium stats={stats} sortBy={sortBy} />}

        {initialLoading && <SkeletonRows />}

        {error && !initialLoading && <ErrorState onRetry={retry} />}

        {!error && (
          <div className="space-y-3">
            {listStats.map((stat, index) => (
              <StudentRow
                key={stat.roll_no}
                stat={stat}
                sortBy={sortBy}
                isMe={stat.roll_no === myRoll}
                isLast={index === listStats.length - 1}
                lastElementRef={lastElementRef}
              />
            ))}
          </div>
        )}

        {loading && !initialLoading && <LoadingSpinner />}

        {!hasMore && stats.length > 0 && !error && <EndNote />}

        {stats.length === 0 && !loading && !initialLoading && !error && (
          <EmptyState search={search} sortBy={sortBy} />
        )}
      </div>
    </div>
  );
}