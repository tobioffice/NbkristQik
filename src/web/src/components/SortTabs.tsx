import type { SortBy } from "../api";

interface SortTabsProps {
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
}

export default function SortTabs({ sortBy, onSortChange }: SortTabsProps) {
  return (
    <div className="flex bg-slate-900/50 p-1 rounded-2xl mb-4 backdrop-blur-xl border border-white/5 shadow-xl relative z-20">
      <button
        onClick={() => onSortChange("attendance")}
        className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${
          sortBy === "attendance"
            ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/30"
            : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        Attendance
      </button>
      <button
        onClick={() => onSortChange("midmarks")}
        className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
          sortBy === "midmarks"
            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30"
            : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        Mid Marks
      </button>
    </div>
  );
}