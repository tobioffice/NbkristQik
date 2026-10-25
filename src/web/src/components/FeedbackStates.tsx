import type { SortBy } from "../api";

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

export const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
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
    <p className="title">The register didn&rsquo;t open</p>
    <p className="sub">It couldn&rsquo;t be fetched just now.</p>
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

export const EndNote = ({ filtered }: { filtered: boolean }) => (
  <div className="end-note">
    <p>{filtered ? "That’s everyone in this view" : "That’s everyone"}</p>
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
  onClearFilters,
}: {
  search: string;
  sortBy: SortBy;
  /** A year/branch/section choice is narrowing the register. */
  filtered: boolean;
  onClearFilters: () => void;
}) => (
  <div className="state-block">
    {search ? <SearchIcon /> : <NotesIcon />}
    {search ? (
      <>
        <p>No results for &ldquo;{search}&rdquo;</p>
        <p className="sub">Try a roll number or part of a name</p>
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
    ) : sortBy === "midmarks" ? (
      <>
        <p>No mid-marks recorded yet.</p>
        <p className="sub">
          They show up once the faculty publishes them. Attendance is ready in
          the meantime.
        </p>
      </>
    ) : (
      <>
        <p>No records yet.</p>
        <p className="sub">Check back after the next sync.</p>
      </>
    )}
  </div>
);
