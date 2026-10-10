import type { SortBy } from "../api";

export const SkeletonRows = () => (
  <div className="space-y-3">
    {[...Array(6)].map((_, i) => (
      <div
        key={i}
        className="bg-slate-900/40 p-4 rounded-xl border border-white/5 flex items-center justify-between animate-pulse"
      >
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-slate-800"></div>
          <div className="space-y-2">
            <div className="h-3.5 w-32 rounded bg-slate-800"></div>
            <div className="h-2.5 w-20 rounded bg-slate-800/70"></div>
          </div>
        </div>
        <div className="h-5 w-12 rounded bg-slate-800"></div>
      </div>
    ))}
  </div>
);

export const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="text-center py-16 space-y-4">
    <p aria-hidden="true" className="text-slate-600 flex justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="36"
        height="36"
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
    </p>
    <p className="text-slate-400 font-medium">The leaderboard didn't load</p>
    <button
      onClick={onRetry}
      className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
    >
      Try again
    </button>
  </div>
);

export const LoadingSpinner = () => (
  <div className="py-8 text-center">
    <div className="inline-block w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
  </div>
);

export const EndNote = () => (
  <div className="text-center py-8">
    <p className="text-slate-600 text-sm font-medium">
      That's everyone
    </p>
  </div>
);

export const EmptyState = ({
  search,
  sortBy,
}: {
  search: string;
  sortBy: SortBy;
}) => (
  <div className="text-center py-20 text-slate-500">
    {search ? (
      <>
        <p className="text-2xl mb-2">🔍</p>
        <p>No results for "{search}"</p>
        <p className="text-xs mt-2 text-slate-600">
          Try a roll number or part of a name
        </p>
      </>
    ) : sortBy === "midmarks" ? (
      <>
        <p className="text-2xl mb-2">📝</p>
        <p>No mid-marks recorded yet.</p>
        <p className="text-xs mt-2 text-slate-600">
          They show up once the faculty publishes them. Attendance is ready
          in the meantime.
        </p>
      </>
    ) : (
      <>
        <p>No records yet.</p>
        <p className="text-xs mt-2">Check back after the next sync.</p>
      </>
    )}
  </div>
);