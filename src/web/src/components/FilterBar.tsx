import { BRANCHES } from "../constants";
import type { LeaderboardFilters } from "../api";

interface FilterBarProps {
  filters: LeaderboardFilters;
  onChange: (patch: Partial<LeaderboardFilters>) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="filter-row">
      <select
        value={filters.year}
        aria-label="Filter by year"
        onChange={(e) => onChange({ year: e.target.value })}
        className="field-select"
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
        className="field-select"
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
        className="field-select"
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
