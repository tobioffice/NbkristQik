import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LeaderboardScope, SortBy, YearFilter } from "./api";
import { requestRankShare } from "./api";
import { AUTO_LOAD_LIMIT, searchQuery, useLeaderboard } from "./useLeaderboard";
import { useTelegramUser } from "./useTelegramUser";
import { useTelegramIdentity } from "./useTelegramIdentity";
import { formatFreshnessRange, formatGap, formatSyncedAt } from "./format";
import { BRANCHES } from "./constants";
import { haptic, telegramWebApp } from "./telegram";
import { useBackHandler } from "./backButton";
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const filterSheetRef = useRef<HTMLDialogElement | null>(null);
  const { initData, tgUser } = useTelegramIdentity();
  const { myRoll, myRank, loading: identityLoading } = useTelegramUser();

  // null means automatic: the saved roll's section once the identity answers,
  // otherwise the whole register. A filter change or "All students" pins the
  // choice to `all`; "My section" pins it back and clears the filters.
  const [chosenScope, setChosenScope] = useState<LeaderboardScope | null>(null);
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

  /**
   * Share the caller's own rank. The server stores a prepared message, then
   * Telegram's native sheet asks which chat to send it to. Nothing is posted
   * unless the student picks a chat.
   */
  const shareRank = useCallback(async () => {
    if (sharing) return;
    const app = telegramWebApp();
    if (!app?.shareMessage) {
      app?.showAlert?.("Sharing needs a newer Telegram app.");
      return;
    }
    setSharing(true);
    haptic.select();
    try {
      const prepared = await requestRankShare({
        initData,
        userId: tgUser ?? undefined,
        sort: sortBy,
      });
      app.shareMessage(prepared.id, (sent) => {
        if (sent) haptic.tap();
      });
    } catch (e) {
      app.showAlert?.(
        e instanceof Error
          ? e.message
          : "Could not prepare the share. Try again.",
      );
    } finally {
      setSharing(false);
    }
  }, [initData, tgUser, sortBy, sharing]);

  const isFiltered =
    search !== "" ||
    filterYear !== "all" ||
    filterBranch !== "all" ||
    filterSection !== "all";
  const narrowedByFilters =
    filterYear !== "all" || filterBranch !== "all" || filterSection !== "all";
  const filterCount =
    (filterYear !== "all" ? 1 : 0) +
    (filterBranch !== "all" ? 1 : 0) +
    (filterSection !== "all" ? 1 : 0);

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

  const closeFilters = useCallback(() => {
    const dialog = filterSheetRef.current;
    if (dialog?.open) {
      dialog.close();
      return;
    }
    setFiltersOpen(false);
  }, []);

  const onFiltersClosed = useCallback(() => {
    haptic.select();
    setFiltersOpen(false);
  }, []);

  // The filter sheet is a native modal dialog: the top layer gives it the
  // inert page, focus containment, Esc/back dismissal and backdrop. The back
  // button hook stays for Telegram's own back gesture.
  useBackHandler(filtersOpen ? closeFilters : null);
  useEffect(() => {
    const dialog = filterSheetRef.current;
    if (!filtersOpen || !dialog) return;
    if (!dialog.open) dialog.showModal();
    // Safari has no closedby yet; keep click-outside dismissal there.
    if (
      typeof HTMLDialogElement === "undefined" ||
      "closedBy" in HTMLDialogElement.prototype
    ) {
      return;
    }
    let pressedOutside = false;
    const outside = (event: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    const down = (event: PointerEvent) => {
      pressedOutside = outside(event);
    };
    const up = (event: PointerEvent) => {
      if (pressedOutside && outside(event)) dialog.close();
      pressedOutside = false;
    };
    dialog.addEventListener("pointerdown", down);
    dialog.addEventListener("pointerup", up);
    return () => {
      dialog.removeEventListener("pointerdown", down);
      dialog.removeEventListener("pointerup", up);
    };
  }, [filtersOpen]);

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
      {showBand && <Band sub="Leaderboard" stamp={stamp} />}

      <div className="reg-body" aria-busy={initialLoading || loading}>
        {myRoll && myRankNow != null && (
          <section className="tg-section">
            <div className="tg-section-head">
              <h2 className="tg-section-title">Your rank</h2>
              <button
                type="button"
                className="tg-link"
                onClick={shareRank}
                disabled={sharing}
              >
                {sharing ? "Preparing…" : "Share"}
              </button>
            </div>
            <button
              type="button"
              className="tg-row tg-your-rank"
              onClick={findMe}
              aria-label={`Your overall ${
                sortBy === "attendance" ? "attendance" : "mid-mark"
              } rank is ${myRankNow} of ${stripTotal.toLocaleString()}. Find your row.`}
            >
              <span className="tg-rank-badge tg-rank-badge--first">
                {myRankNow}
              </span>
              <span className="tg-row__body">
                <span className="tg-row__title">{myRoll}</span>
                <span className="tg-row__sub">
                  of {stripTotal.toLocaleString()} students
                </span>
              </span>
              <span className="tg-row__score">
                {stripValue ?? "—"}
                {stripValue ? (
                  <span className="tg-row__score-note">
                    {sortBy === "attendance" && myRankInfo?.value != null
                      ? formatGap(myRankInfo.value)
                      : "Mid-mark average"}
                  </span>
                ) : null}
              </span>
            </button>
          </section>
        )}

        <div className="tg-controls">
          <div className="tg-search-row">
            <div className="tg-search">
              <SearchBar
                value={searchInput}
                onChange={setSearchInput}
                identified={Boolean(initData)}
              />
            </div>
            <button
              type="button"
              className="tg-filter-button"
              onClick={() => {
                haptic.select();
                setFiltersOpen(true);
              }}
              aria-label={
                filterCount > 0 ? `Filters, ${filterCount} active` : "Filters"
              }
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              aria-controls="tg-filter-sheet"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 7h8" />
                <path d="M16 7h4" />
                <circle cx="14" cy="7" r="2" />
                <path d="M4 17h4" />
                <path d="M12 17h8" />
                <circle cx="10" cy="17" r="2" />
              </svg>
              {filterCount > 0 ? (
                <span className="tg-filter-badge">{filterCount}</span>
              ) : null}
            </button>
          </div>

          <SortTabs
            sortBy={sortBy}
            onSortChange={(next) => {
              haptic.select();
              setSortBy(next);
            }}
          />

          {sortBy === "midmarks" && (
            <p className="tg-hint">
              Average of M1/M2 across subjects; compare within a section.
            </p>
          )}

          {/* Always present, as in the old register: without a saved roll
              the first side is disabled and the whole register is the view. */}
          <div className="tg-pills" role="group" aria-label="Register scope">
            <button
              type="button"
              className="tg-pill"
              aria-pressed={scopeMode === "me"}
              disabled={!myRoll}
              title={
                !myRoll
                  ? "Save your roll in Profile to open your section"
                  : scopeMode === "me"
                    ? scopeTitle
                    : undefined
              }
              onClick={showMySection}
            >
              My section
            </button>
            <button
              type="button"
              className="tg-pill"
              aria-pressed={scopeMode === "all"}
              onClick={showAllStudents}
            >
              All students
            </button>
          </div>

          {(isFiltered || synced) && (
            <div className="tg-meta">
              {showMetaClear ? (
                <button
                  type="button"
                  className="tg-link"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              ) : (
                <span />
              )}
              {synced ? (
                <span
                  className="tg-meta__sync"
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
            <p className="tg-hint">
              {coverageLabel}.
              {showFillNote ? " This register fills as students check." : null}
            </p>
          )}
        </div>

        {refreshing && (
          <p className="tg-hint tg-hint--status" role="status">
            Updating the register&hellip;
          </p>
        )}

        {initialLoading && <SkeletonRows />}

        {error && !initialLoading && stats.length === 0 && (
          <ErrorState onRetry={retry} message={errorMessage} />
        )}

        {error && stats.length > 0 && !initialLoading && (
          <p className="tg-error" role="alert">
            {errorMessage ?? "The register couldn’t refresh."}{" "}
            <button type="button" className="tg-link" onClick={retry}>
              Try again
            </button>
          </p>
        )}

        <div className={refreshing ? "tg-refreshing" : undefined}>
          {podiumVisible && (
            <section className="tg-section">
              <h2 className="tg-section-title">Top three</h2>
              <Podium
                stats={stats}
                sortBy={sortBy}
                loaded={stats.length}
                total={total}
              />
            </section>
          )}

          {listStats.length > 0 && (
            <section className="tg-section">
              <div className="tg-section-head">
                <h2 className="tg-section-title">
                  {search ? "Search results" : "All students"}
                </h2>
                <span className="tg-section-count">
                  {total.toLocaleString()}
                </span>
              </div>
              <ol
                className="reg-list tg-group"
                aria-label={`Students ranked by ${
                  sortBy === "attendance" ? "attendance" : "mid-marks"
                }`}
              >
                {lineBeforeFirst && <TheLine />}
                {listStats.map((stat, index) => (
                  <Fragment
                    key={
                      stat.hidden
                        ? `hidden-${stat.rank}-${index}`
                        : stat.roll_no
                    }
                  >
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
            </section>
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

        {filtersOpen && (
          <dialog
            id="tg-filter-sheet"
            ref={filterSheetRef}
            className="tg-sheet"
            aria-labelledby="tg-filter-title"
            closedby="any"
            onClose={onFiltersClosed}
          >
              <div className="tg-sheet-grabber" aria-hidden="true" />
              <div className="tg-sheet-head">
                <div>
                  <h2 className="tg-sheet-title" id="tg-filter-title">
                    Filters
                  </h2>
                  <p className="tg-sheet-desc">Year, branch and section.</p>
                </div>
                <button
                  type="button"
                  className="tg-sheet-close"
                  onClick={closeFilters}
                  aria-label="Close filters"
                >
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              <div className="tg-sheet-body">
                <FilterBar
                  filters={filters}
                  sections={sections}
                  onChange={(patch) => {
                    haptic.select();
                    // a custom slice of the register is a whole-register view,
                    // not the caller's section with one more filter
                    setChosenScope("all");
                    if (patch.year !== undefined) setFilterYear(patch.year);
                    if (patch.branch !== undefined)
                      setFilterBranch(patch.branch);
                    if (patch.section !== undefined)
                      setFilterSection(patch.section);
                  }}
                />
              </div>
              <div className="tg-sheet-actions">
                <button
                  type="button"
                  className="tg-link"
                  onClick={clearFilters}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="tg-sheet-done"
                  onClick={closeFilters}
                >
                  Done
                </button>
              </div>
          </dialog>
        )}
      </div>
    </>
  );
}
