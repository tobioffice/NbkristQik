import { BRANCHES } from "../constants";
import type { LeaderboardFilters } from "../api";

interface FilterBarProps {
  filters: LeaderboardFilters;
  onChange: (patch: Partial<LeaderboardFilters>) => void;
  /** Sections the API reports for the chosen year/branch; null until known. */
  sections: string[] | null;
}

const FALLBACK_SECTIONS = [
  "-",
  ...Array.from({ length: 10 }, (_, i) => String.fromCharCode(65 + i)),
];

const sectionLabel = (value: string): string =>
  value === "-"
    ? "No section"
    : /^[a-z]$/i.test(value)
      ? `Section ${value.toUpperCase()}`
      : value;

export default function FilterBar({
  filters,
  onChange,
  sections,
}: FilterBarProps) {
  const known = sections && sections.length > 0 ? sections : FALLBACK_SECTIONS;
  // keep the current choice selectable while a new branch's facets are in
  // flight, so the control never goes blank
  const options =
    filters.section !== "all" && !known.includes(filters.section)
      ? [filters.section, ...known]
      : known;

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
        {options.map((value) => (
          <option key={value} value={value}>
            {sectionLabel(value)}
          </option>
        ))}
      </select>
    </div>
  );
}
