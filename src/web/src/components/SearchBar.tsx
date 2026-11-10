interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Anonymous callers may search rolls only; the server hides names. */
  identified?: boolean;
}

export default function SearchBar({
  value,
  onChange,
  identified = false,
}: SearchBarProps) {
  const label = identified
    ? "Search students by name or roll number"
    : "Search students by roll number";
  const placeholder = identified ? "Name or roll number" : "Roll number";
  // one character is not a search: the server would reject it, and the
  // register stays unfiltered until a second character arrives
  const tooShort = value.trim().length === 1;
  return (
    <>
      {/* the relative box is the field alone, so the icon and clear button
          stay centred on the input when the hint below is showing */}
      <div className="search-field">
        <input
          type="text"
          aria-label={label}
          aria-describedby={tooShort ? "search-min-hint" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <span aria-hidden="true" className="search-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        {value && (
          <button
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="search-clear"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
      {tooShort && (
        <p className="hint-line" id="search-min-hint">
          Type at least 2 characters.
        </p>
      )}
    </>
  );
}
