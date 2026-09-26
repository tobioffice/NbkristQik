import { formatScore, rankBadgeClass } from "../format";
import type { SortBy, StudentStat } from "../api";

interface StudentRowProps {
  stat: StudentStat;
  sortBy: SortBy;
  isMe: boolean;
  isLast: boolean;
  lastElementRef?: (node: HTMLDivElement) => void;
}

export default function StudentRow({
  stat,
  sortBy,
  isMe,
  isLast,
  lastElementRef,
}: StudentRowProps) {
  return (
    <div
      ref={isLast && lastElementRef ? lastElementRef : null}
      className={`group relative backdrop-blur-md p-4 rounded-xl border transition-all duration-300 flex items-center justify-between ${
        isMe
          ? "bg-indigo-500/15 border-indigo-400/50 shadow-lg shadow-indigo-500/10"
          : "bg-slate-900/40 hover:bg-slate-800/60 border-white/5 hover:border-indigo-500/30"
      }`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className={rankBadgeClass(stat.rank)}>#{stat.rank}</div>

        <div className="min-w-0">
          <h3
            className={`font-semibold text-sm truncate ${
              isMe ? "text-white" : "text-slate-300"
            }`}
          >
            {stat.name || stat.roll_no}
            {isMe && (
              <span className="ml-2 text-[10px] font-bold text-indigo-300 bg-indigo-500/20 rounded px-1.5 py-0.5 align-middle">
                YOU
              </span>
            )}
          </h3>
          <p className="font-mono text-[10px] text-slate-500">{stat.roll_no}</p>
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <span
          className={`text-lg font-bold ${
            sortBy === "attendance" ? "text-indigo-400" : "text-emerald-400"
          }`}
        >
          {formatScore(stat, sortBy)}
        </span>
        <span className="text-xs text-slate-600 font-medium ml-0.5">
          {sortBy === "attendance" ? "%" : ""}
        </span>
      </div>
    </div>
  );
}