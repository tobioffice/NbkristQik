import { BRANCHES } from "../constants";
import type { LeaderboardFilters } from "../api";

const selectClass =
  "bg-slate-900/50 text-slate-300 text-xs md:text-sm rounded-lg p-2.5 border border-white/5 focus:outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-400/40 cursor-pointer";

interface FilterBarProps {
  filters: LeaderboardFilters;
  onChange: (patch: Partial<LeaderboardFilters>) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-8">
      <select
        value={filters.year}
        aria-label="Filter by year"
        onChange={(e) => onChange({ year: e.target.value })}
        className={selectClass}
      >
        <option value="all">All Years</option>
        <option value="11">1st Year</option>
        <option value="21">2nd Year</option>
        <option value="31">3rd Year</option>
        <option value="41">4th Year</option>
      </select>

      <select
        value={filters.branch}
        aria-label="Filter by branch"
        onChange={(e) => onChange({ branch: e.target.value })}
        className={selectClass}
      >
        <option value="all">All Branches</option>
        {Object.entries(BRANCHES).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>

      <select
        value={filters.section}
        aria-label="Filter by section"
        onChange={(e) => onChange({ section: e.target.value })}
        className={selectClass}
      >
        <option value="all">All Sections</option>
        <option value="-">-</option>
        {Array.from({ length: 10 }, (_, i) => String.fromCharCode(65 + i)).map(
          (char) => (
            <option key={char} value={char}>
              Section {char}
            </option>
          ),
        )}
      </select>
    </div>
  );
}