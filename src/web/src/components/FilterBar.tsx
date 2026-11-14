import { BRANCHES } from "../constants";
import type { LeaderboardFilters, YearFilter } from "../api";

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

/**
 * Three settings rows, not three floating selects: label on the left, value
 * on the right, one surface group. This is the Telegram-native filter shape.
 */
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
    <div
      className="tg-filter-group"
      role="group"
      aria-label="Filter the register"
    >
      <label className="tg-select-row">
        <span className="tg-select-row__label">Year</span>
        <select
          value={filters.year}
          aria-label="Filter by year"
          onChange={(e) => onChange({ year: e.target.value as YearFilter })}
          className="tg-select"
        >
          <option value="all">All years</option>
          <option value="1">1st year</option>
          <option value="2">2nd year</option>
          <option value="3">3rd year</option>
          <option value="4">4th year</option>
        </select>
      </label>

      <label className="tg-select-row">
        <span className="tg-select-row__label">Branch</span>
        <select
          value={filters.branch}
          aria-label="Filter by branch"
          onChange={(e) => onChange({ branch: e.target.value })}
          className="tg-select"
        >
          <option value="all">All branches</option>
          {Object.entries(BRANCHES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="tg-select-row">
        <span className="tg-select-row__label">Section</span>
        <select
          value={filters.section}
          aria-label="Filter by section"
          onChange={(e) => onChange({ section: e.target.value })}
          className="tg-select"
        >
          <option value="all">All sections</option>
          {options.map((value) => (
            <option key={value} value={value}>
              {sectionLabel(value)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
