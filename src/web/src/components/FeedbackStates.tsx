import type { LeaderboardCoverage, SortBy } from "../api";

export const SkeletonRows = () => (
  <>
    {[...Array(6)].map((_, i) => (
      <div key={i} className="skeleton-row" aria-hidden="true">
        <span className="sk sk--rank" />
        <span className="sk sk--roll" />
        <span className="sk sk--name" />
        <span className="sk sk--score" />
      </div>
    ))}
  </>
);

export const ErrorState = ({
  onRetry,
  message,
}: {
  onRetry: () => void;
  /** The server's own sentence, when it gave one. */
  message?: string | null;
}) => (
  <div className="state-block">
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 12v8" />
      <path d="M8.5 8.5a5 5 0 0 1 7 0" />
      <path d="M5 5a10 10 0 0 1 14 0" />
      <line x1="12" x2="12.01" y1="2" y2="2" />
    </svg>
    <p className="title">
      {message ? "That didn’t go through" : "The register didn’t open"}
    </p>
    <p className="sub">{message ?? "It couldn’t be fetched just now."}</p>
    <p style={{ marginTop: 18 }}>
      <button onClick={onRetry} className="btn-ink">
        Try again
      </button>
    </p>
  </div>
);

export const LoadingSpinner = () => (
  <div className="loading-inline" role="status" aria-label="Loading more">
    <div className="spinner" />
  </div>
);

/**
 * The end of the register. Completeness is only provable when the directory
 * count is a real denominator and every one of those students has a figure;
 * otherwise say how far the partial register has filled.
 */
// the copy rule is the testable heart of EndNote; splitting it out would hide
// that, so the module keeps both under a scoped fast-refresh exception
// eslint-disable-next-line react-refresh/only-export-components
export const endNoteMessage = (
  filtered: boolean,
  coverage: LeaderboardCoverage | null,
): string => {
  const ranked = coverage?.ranked ?? 0;
  const known = coverage?.known ?? 0;
  if (known > 0 && ranked >= known) return "That’s everyone in this view";
  if (ranked > 0) {
    return `${ranked.toLocaleString()} ranked so far. The register fills as students check.`;
  }
  return filtered
    ? "That’s everyone in this view"
    : "The register fills as students check.";
};

export const EndNote = ({
  filtered,
  coverage,
}: {
  filtered: boolean;
  /** Ranked vs. known students for this view; null when unknown. */
  coverage: LeaderboardCoverage | null;
}) => (
  <div className="end-note">
    <p>{endNoteMessage(filtered, coverage)}</p>
  </div>
);

const NotesIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="30"
    height="30"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 3.5h14v17H5z" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h5" />
  </svg>
);

const SearchIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="30"
    height="30"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const EmptyState = ({
  search,
  sortBy,
  filtered,
  identified,
  onClearFilters,
}: {
  search: string;
  sortBy: SortBy;
  /** A year/branch/section choice is narrowing the register. */
  filtered: boolean;
  /** Anonymous callers can search rolls only; names stay hidden. */
  identified: boolean;
  onClearFilters: () => void;
}) => (
  <div className="state-block">
    {search ? <SearchIcon /> : <NotesIcon />}
    {search ? (
      <>
        <p>No results for &ldquo;{search}&rdquo;</p>
        <p className="sub">
          {identified
            ? "Try a roll number or part of a name"
            : "Try a roll number"}
        </p>
      </>
    ) : filtered ? (
      <>
        <p>Nobody is in this view.</p>
        <p className="sub">
          The filters are narrower than the register. Try another branch,
          section or year.
        </p>
        <p style={{ marginTop: 18 }}>
          <button onClick={onClearFilters} className="btn-outline">
            Clear filters
          </button>
        </p>
      </>
    ) : (
      <>
        <p>No one is ranked here yet.</p>
        <p className="sub">
          {sortBy === "midmarks"
            ? "Mid-marks show up once the faculty publishes them. The register fills as students check."
            : "The register fills as students check."}
        </p>
      </>
    )}
  </div>
);
