import type { SortBy } from "../api";

interface SortTabsProps {
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
}

export default function SortTabs({ sortBy, onSortChange }: SortTabsProps) {
  return (
    <div className="sort-tabs" role="group" aria-label="Sort the register by">
      <button
        type="button"
        aria-pressed={sortBy === "attendance"}
        onClick={() => onSortChange("attendance")}
      >
        Attendance
      </button>
      <button
        type="button"
        aria-pressed={sortBy === "midmarks"}
        onClick={() => onSortChange("midmarks")}
      >
        Mid Marks
      </button>
    </div>
  );
}
