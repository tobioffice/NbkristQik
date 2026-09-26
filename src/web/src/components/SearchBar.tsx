interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

const iconBtn =
  "cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 rounded";

export default function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative mb-4">
      <input
        type="text"
        aria-label="Search students by name or roll number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search your name or roll number..."
        className="w-full bg-slate-900/50 text-slate-200 text-sm rounded-xl p-3.5 pl-10 border border-white/5 focus:outline-none focus:border-indigo-500/50 focus-visible:ring-2 focus-visible:ring-indigo-400/40 placeholder:text-slate-600"
      />
      <span
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
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
          className={`${iconBtn} absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300 p-1.5`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
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
  );
}