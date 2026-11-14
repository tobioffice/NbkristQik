import type { SortBy } from "../api";

interface SortTabsProps {
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
}

/** Telegram-style pill tabs: one quiet surface, one selected surface. */
export default function SortTabs({ sortBy, onSortChange }: SortTabsProps) {
  return (
    <div className="tg-pills" role="group" aria-label="Sort the register by">
      <button
        type="button"
        className="tg-pill"
        aria-pressed={sortBy === "attendance"}
        onClick={() => onSortChange("attendance")}
      >
        Attendance
      </button>
      <button
        type="button"
        className="tg-pill"
        aria-pressed={sortBy === "midmarks"}
        onClick={() => onSortChange("midmarks")}
      >
        Mid marks
      </button>
    </div>
  );
}
