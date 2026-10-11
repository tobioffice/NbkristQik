import { Fragment, useEffect, useMemo, useState } from "react";
import type { SortBy } from "./api";
import { useLeaderboard } from "./useLeaderboard";
import { useTelegramUser } from "./useTelegramUser";
import Band from "./components/Band";
import SearchBar from "./components/SearchBar";
import SortTabs from "./components/SortTabs";
import FilterBar from "./components/FilterBar";
import Podium from "./components/Podium";
import StudentRow from "./components/StudentRow";
import TheLine from "./components/TheLine";
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

  // where the 75% rule falls: after the last confirmed row when the loaded
  // rows cross the line (attendance only — the minimum is an attendance rule)
  const lineAfter = useMemo(() => {
    if (sortBy !== "attendance" || search) return -1;
    for (let i = 0; i < listStats.length - 1; i++) {
      if (
        listStats[i].attendance_percentage >= 75 &&
        listStats[i + 1].attendance_percentage < 75
      ) {
        return i;
      }
    }
    return -1;
  }, [listStats, sortBy, search]);

  // the crossing can sit on the podium/list boundary (top three above the
  // line, the list below it) — then the rule opens the list
  const lineBeforeFirst =
    lineAfter === -1 &&
    sortBy === "attendance" &&
    !search &&
    listStats.length > 0 &&
    listStats[0].attendance_percentage < 75 &&
    stats.some((s) => s.attendance_percentage >= 75);

  return (
    <>
      <Band
        sub="Attendance register"
        stamp={
          !initialLoading && total > 0 && !error
            ? {
                value: total.toLocaleString(),
                label: total === 1 ? "student" : "students",
              }
            : null
        }
      />

      <div className="reg-body">
        {/* the viewer's own entry, bracketed in the margin */}
        {myRoll && myRankNow != null && !initialLoading && !error && !isFiltered && (
          <div className="entry-strip">
            <div className="entry-strip__id">
              <div className="entry-strip__roll">{myRoll}</div>
              <div className="entry-strip__rank">
                #{myRankNow}
                <small>of {total.toLocaleString()}</small>
              </div>
            </div>
            <div className="entry-strip__meta">
              <span>
                {sortBy === "attendance"
                  ? "Attendance rank"
                  : "Mid-mark rank"}
              </span>
            </div>
          </div>
        )}

        <SortTabs sortBy={sortBy} onSortChange={setSortBy} />

        <div className="controls">
          <SearchBar value={searchInput} onChange={setSearchInput} />
          <FilterBar
            filters={filters}
            onChange={(patch) => {
              if (patch.year !== undefined) setFilterYear(patch.year);
              if (patch.branch !== undefined) setFilterBranch(patch.branch);
              if (patch.section !== undefined) setFilterSection(patch.section);
            }}
          />
        </div>

        {podiumVisible && <Podium stats={stats} sortBy={sortBy} />}

        {initialLoading && <SkeletonRows />}

        {error && !initialLoading && <ErrorState onRetry={retry} />}

        {!error && listStats.length > 0 && (
          <>
            <div className="list-head" aria-hidden="true">
              <span>Rnk</span>
              <span>Roll</span>
              <span>Name</span>
              <span>{sortBy === "attendance" ? "Att %" : "Mid avg"}</span>
            </div>
            {lineBeforeFirst && <TheLine />}
            {listStats.map((stat, index) => (
              <Fragment key={stat.roll_no}>
                <StudentRow
                  stat={stat}
                  sortBy={sortBy}
                  // guard: myRoll is null for unidentified viewers, and a ghost
                  // row's roll_no is also null — null === null must not mean "me"
                  isMe={myRoll != null && stat.roll_no === myRoll}
                  isLast={index === listStats.length - 1}
                  lastElementRef={lastElementRef}
                />
                {index === lineAfter && <TheLine />}
              </Fragment>
            ))}
          </>
        )}

        {loading && !initialLoading && <LoadingSpinner />}

        {!hasMore && stats.length > 0 && !error && <EndNote />}

        {stats.length === 0 && !loading && !initialLoading && !error && (
          <EmptyState search={search} sortBy={sortBy} />
        )}
      </div>
    </>
  );
}
