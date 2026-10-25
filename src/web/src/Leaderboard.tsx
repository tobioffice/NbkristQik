import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { SortBy } from "./api";
import { AUTO_LOAD_LIMIT, useLeaderboard } from "./useLeaderboard";
import { useTelegramUser } from "./useTelegramUser";
import { formatGap, formatSyncedAt } from "./format";
import { haptic } from "./telegram";
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
import { useBandStamp } from "./bandStamp";

interface LeaderboardProps {
  /**
   * Draw the cloth band here. False when the app shell already owns the band
   * (its tabbed surface): the count then goes up as the band's stamp.
   */
  showBand?: boolean;
}

export default function Leaderboard({ showBand = true }: LeaderboardProps) {
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
  } = useLeaderboard(sortBy, filters, search);
  const { myRoll, myRank } = useTelegramUser();

  const myRankInfo = myRoll
    ? sortBy === "attendance"
      ? myRank?.attendance
      : myRank?.midmarks
    : null;
  const myRankNow = myRankInfo?.rank ?? null;

  const isFiltered =
    search !== "" ||
    filterYear !== "all" ||
    filterBranch !== "all" ||
    filterSection !== "all";
  const narrowedByFilters =
    filterYear !== "all" || filterBranch !== "all" || filterSection !== "all";

  // when the empty state is on screen it carries its own Clear filters
  // button; a second one in the margin would be noise
  const showMetaClear =
    isFiltered && (stats.length > 0 || initialLoading || loading || error);

  const podiumVisible = stats.length > 0 && !search;
  const listStats = search ? stats : stats.slice(3);

  const synced = formatSyncedAt(updatedAt);

  // a branch/year change can strand the section filter on a value that no
  // longer exists; drop it once the live section list says so
  useEffect(() => {
    if (!sections || filterSection === "all") return;
    if (!sections.includes(filterSection)) setFilterSection("all");
  }, [sections, filterSection]);

  // a new query starts at the head of the sheet, not wherever the old list
  // left the reader
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [sortBy, filters, search]);

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

  const stamp =
    !initialLoading && total > 0 && !error
      ? {
          value: total.toLocaleString(),
          label: total === 1 ? "student" : "students",
        }
      : null;
  useBandStamp(showBand ? null : stamp);

  /** Narrow the register to the viewer's own row. */
  const findMe = useCallback(() => {
    if (!myRoll) return;
    haptic.tap();
    setFilterYear("all");
    setFilterBranch("all");
    setFilterSection("all");
    setSearchInput(myRoll);
    setSearch(myRoll);
  }, [myRoll]);

  const clearFilters = useCallback(() => {
    haptic.select();
    setFilterYear("all");
    setFilterBranch("all");
    setFilterSection("all");
    setSearchInput("");
    setSearch("");
  }, []);

  const stripTotal =
    myRankInfo?.total && myRankInfo.total > 0 ? myRankInfo.total : total;
  const stripValue =
    myRankInfo?.value == null
      ? null
      : sortBy === "attendance"
        ? `${myRankInfo.value.toFixed(2)}%`
        : myRankInfo.value.toFixed(1);

  return (
    <>
      {showBand && <Band sub="Attendance register" stamp={stamp} />}

      <div className="reg-body" aria-busy={initialLoading || loading}>
        {/* the viewer's own entry, bracketed in the margin */}
        {myRoll && myRankNow != null && (
          <button
            type="button"
            className="entry-strip entry-strip--action"
            onClick={findMe}
            aria-label={`Your overall ${
              sortBy === "attendance" ? "attendance" : "mid-mark"
            } rank is ${myRankNow} of ${stripTotal.toLocaleString()}. Find your row.`}
          >
            <span className="entry-strip__id">
              <span className="entry-strip__roll">{myRoll}</span>
              <span className="entry-strip__rank">
                #{myRankNow} <small>of {stripTotal.toLocaleString()}</small>
              </span>
            </span>
            <span className="entry-strip__meta">
              {stripValue ? (
                <>
                  <span className="entry-strip__score">{stripValue}</span>
                  <span className="entry-strip__note">
                    {sortBy === "attendance" && myRankInfo?.value != null
                      ? formatGap(myRankInfo.value)
                      : "Mid-mark average"}
                  </span>
                </>
              ) : (
                <span className="entry-strip__note">No figure yet</span>
              )}
            </span>
          </button>
        )}

        <SortTabs
          sortBy={sortBy}
          onSortChange={(next) => {
            haptic.select();
            setSortBy(next);
          }}
        />

        <div className="controls">
          <SearchBar value={searchInput} onChange={setSearchInput} />
          <FilterBar
            filters={filters}
            sections={sections}
            onChange={(patch) => {
              haptic.select();
              if (patch.year !== undefined) setFilterYear(patch.year);
              if (patch.branch !== undefined) setFilterBranch(patch.branch);
              if (patch.section !== undefined) setFilterSection(patch.section);
            }}
          />
          {(isFiltered || synced) && (
            <div className="reg-meta">
              {showMetaClear ? (
                <button
                  type="button"
                  className="link-btn reg-meta__clear"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              ) : (
                <span />
              )}
              {synced ? (
                <span
                  className="reg-meta__sync"
                  title={
                    updatedAt ? `Last written ${updatedAt} UTC` : undefined
                  }
                >
                  {synced}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {podiumVisible && (
          <Podium
            stats={stats}
            sortBy={sortBy}
            loaded={stats.length}
            total={total}
          />
        )}

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
            <ol
              className="reg-list"
              aria-label={`Students ranked by ${
                sortBy === "attendance" ? "attendance" : "mid-marks"
              }`}
            >
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
            </ol>
          </>
        )}

        {loading && !initialLoading && <LoadingSpinner />}

        {!error && hasMore && !initialLoading && (
          <div className="load-more">
            {moreError && (
              <p className="load-more__note" role="alert">
                The next page didn&rsquo;t load.
              </p>
            )}
            <button
              type="button"
              className="btn-outline load-more__btn"
              disabled={loading && !moreError}
              onClick={() => {
                haptic.tap();
                if (moreError) retryMore();
                else loadMore();
              }}
            >
              {moreError ? "Try again" : loading ? "Loading..." : "Load more"}
            </button>
            {stats.length >= AUTO_LOAD_LIMIT &&
              !moreError &&
              total > stats.length && (
                <p className="load-more__note">
                  Showing {stats.length} of {total.toLocaleString()}. Tap to
                  keep going.
                </p>
              )}
          </div>
        )}

        {!hasMore && stats.length > 0 && !error && (
          <EndNote filtered={isFiltered} />
        )}

        {stats.length === 0 && !loading && !initialLoading && !error && (
          <EmptyState
            search={search}
            sortBy={sortBy}
            filtered={narrowedByFilters}
            onClearFilters={clearFilters}
          />
        )}
      </div>
    </>
  );
}
