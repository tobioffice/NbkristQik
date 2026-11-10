import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { LeaderboardScope, SortBy, YearFilter } from "./api";
import {
  AUTO_LOAD_LIMIT,
  searchQuery,
  useLeaderboard,
} from "./useLeaderboard";
import { useTelegramUser } from "./useTelegramUser";
import { useTelegramIdentity } from "./useTelegramIdentity";
import { formatFreshnessRange, formatGap, formatSyncedAt } from "./format";
import { BRANCHES } from "./constants";
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
  const [filterYear, setFilterYear] = useState<YearFilter>("all");
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { initData } = useTelegramIdentity();
  const { myRoll, myRank, loading: identityLoading } = useTelegramUser();

  // null means automatic: the saved roll's section once the identity answers,
  // otherwise the whole register. A filter change or "All students" pins the
  // choice to `all`; "My section" pins it back and clears the filters.
  const [chosenScope, setChosenScope] = useState<LeaderboardScope | null>(
    null,
  );
  const scopeMode: LeaderboardScope = chosenScope ?? (myRoll ? "me" : "all");

  // stable identity so the fetch effect only fires on real filter changes
  const filters = useMemo(
    () => ({ year: filterYear, branch: filterBranch, section: filterSection }),
    [filterYear, filterBranch, filterSection],
  );

  // Debounced search -> triggers refetch via hook deps. One character is
  // not a search: it would be rejected, so the register stays unfiltered
  // until a second character arrives (SearchBar shows the hint).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchQuery(searchInput)), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const {
    stats,
    total,
    updatedAt,
    coverage,
    freshness,
    scope,
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
  } = useLeaderboard(
    sortBy,
    filters,
    scopeMode,
    search,
    initData,
    !identityLoading,
  );

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

  // a wide write range must not read as one fresh sync
  const synced = freshness
    ? formatFreshnessRange(freshness.newest, freshness.oldest)
    : formatSyncedAt(updatedAt);
  const newestStamp = freshness?.newest ?? updatedAt;

  // coverage is ranked against the directory, never the whole college
  const coverageLabel = coverage
    ? coverage.known > 0
      ? `${coverage.ranked.toLocaleString()} of ${coverage.known.toLocaleString()} known students seen`
      : `${coverage.ranked.toLocaleString()} ranked so far`
    : null;
  const partialCoverage =
    coverage != null && coverage.known > 0 && coverage.ranked < coverage.known;
  // the unfiltered empty state already carries the "register fills" sentence;
  // printing it twice on one screen is noise
  const showFillNote = partialCoverage && (stats.length > 0 || isFiltered);

  // what `scope=me` actually resolved to, for the button's tooltip
  const scopeTitle = useMemo(() => {
    if (!scope) return undefined;
    const branch = scope.branch
      ? (BRANCHES[Number(scope.branch)] ?? scope.branch)
      : null;
    const year = scope.year ? `Year ${scope.year}` : null;
    const section = scope.section ? `Section ${scope.section}` : null;
    return [branch, year, section].filter(Boolean).join(" · ") || undefined;
  }, [scope]);

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
  }, [sortBy, filters, scopeMode, search]);

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

  /** Return to the saved roll's own section: no filters, no search. */
  const showMySection = useCallback(() => {
    clearFilters();
    setChosenScope("me");
  }, [clearFilters]);

  /** Keep the current filters, but open them to the whole register. */
  const showAllStudents = useCallback(() => {
    haptic.select();
    setChosenScope("all");
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

        {sortBy === "midmarks" && (
          <p className="hint-line" style={{ margin: "0 16px 10px" }}>
            Average of M1/M2 across subjects; compare within a section.
          </p>
        )}

        <div className="controls">
          {/* the saved roll's own section is the default; "All" is deliberate */}
          {myRoll && (
            <div
              className="sort-tabs"
              role="group"
              aria-label="Register scope"
              style={{ margin: 0 }}
            >
              <button
                type="button"
                aria-pressed={scopeMode === "me"}
                title={scopeMode === "me" ? scopeTitle : undefined}
                onClick={showMySection}
              >
                My section
              </button>
              <button
                type="button"
                aria-pressed={scopeMode === "all"}
                onClick={showAllStudents}
              >
                All students
              </button>
            </div>
          )}

          <SearchBar
            value={searchInput}
            onChange={setSearchInput}
            identified={Boolean(initData)}
          />
          <FilterBar
            filters={filters}
            sections={sections}
            onChange={(patch) => {
              haptic.select();
              // a custom slice of the register is a whole-register view, not
              // the caller's section with one more filter
              setChosenScope("all");
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
                    newestStamp ? `Last written ${newestStamp} UTC` : undefined
                  }
                >
                  {synced}
                </span>
              ) : null}
            </div>
          )}
          {coverageLabel && (
            <p className="hint-line">
              {coverageLabel}.
              {showFillNote
                ? " This register fills as students check."
                : null}
            </p>
          )}
        </div>

        {refreshing && (
          <p
            className="hint-line"
            role="status"
            style={{ padding: "0 16px 8px" }}
          >
            Updating the register&hellip;
          </p>
        )}

        {initialLoading && <SkeletonRows />}

        {error && !initialLoading && stats.length === 0 && (
          <ErrorState onRetry={retry} message={errorMessage} />
        )}

        {error && stats.length > 0 && !initialLoading && (
          <p
            className="note note--err"
            role="alert"
            style={{ margin: "0 16px 14px" }}
          >
            {errorMessage ?? "The register couldn’t refresh."}{" "}
            <button type="button" className="link-btn" onClick={retry}>
              Try again
            </button>
          </p>
        )}

        <div
          style={
            refreshing
              ? { opacity: 0.55, transition: "opacity 0.12s ease" }
              : undefined
          }
        >
          {podiumVisible && (
            <Podium
              stats={stats}
              sortBy={sortBy}
              loaded={stats.length}
              total={total}
            />
          )}

          {listStats.length > 0 && (
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
        </div>

        {loading && !initialLoading && !refreshing && <LoadingSpinner />}

        {!error && hasMore && !initialLoading && !refreshing && (
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
          <EndNote filtered={isFiltered} coverage={coverage} />
        )}

        {stats.length === 0 && !loading && !initialLoading && !error && (
          <EmptyState
            search={search}
            sortBy={sortBy}
            filtered={narrowedByFilters}
            identified={Boolean(initData)}
            onClearFilters={clearFilters}
          />
        )}
      </div>
    </>
  );
}
