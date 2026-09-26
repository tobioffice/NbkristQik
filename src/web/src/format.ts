export const formatScore = (
  stat: { attendance_percentage: number; mid_marks_avg: number | null },
  sortBy: "attendance" | "midmarks",
): string =>
  sortBy === "attendance"
    ? (stat.attendance_percentage?.toFixed(2) ?? "-")
    : stat.mid_marks_avg != null
      ? stat.mid_marks_avg.toFixed(1)
      : "-";

// tie-aware rank badge: same rank = same color
export const rankBadgeClass = (rank: number): string =>
  `w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg font-bold text-sm font-mono border ${
    rank === 1
      ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
      : rank <= 3
        ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
        : "bg-slate-800 text-slate-500 border-slate-700"
  }`;
