import { formatScore } from "../format";
import type { SortBy, StudentStat } from "../api";

type PodiumVariant = "gold" | "silver" | "bronze";

// exact classes preserved from the original inline markup
const VARIANTS: Record<
  PodiumVariant,
  { card: string; badge: string; strikeWhenRank: number | null }
> = {
  gold: {
    card: "bg-gradient-to-b from-indigo-900/40 to-slate-900/40 backdrop-blur-md rounded-2xl border border-yellow-500/30 p-2 md:p-4 shadow-2xl shadow-yellow-500/20",
    badge: "",
    strikeWhenRank: null,
  },
  silver: {
    card: "bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/50 p-3 shadow-lg",
    badge:
      "bg-gradient-to-b from-slate-300 to-slate-500 shadow-lg shadow-slate-500/40",
    strikeWhenRank: 2,
  },
  bronze: {
    card: "bg-slate-800/60 backdrop-blur-md rounded-2xl border border-orange-700/30 p-3 shadow-lg",
    badge:
      "bg-gradient-to-b from-orange-300 to-orange-600 shadow-lg shadow-orange-500/40",
    strikeWhenRank: 3,
  },
};

const CARD_BASE =
  "relative w-full aspect-[3/4.5] flex flex-col items-center justify-center transform hover:scale-105 transition-transform duration-300";

const ScoreStat = ({ stat, sortBy }: { stat: StudentStat; sortBy: SortBy }) => (
  <div className="text-center">
    <span
      className={`text-2xl font-bold tracking-tight ${
        sortBy === "attendance" ? "text-indigo-400" : "text-emerald-400"
      }`}
    >
      {formatScore(stat, sortBy)}
    </span>
    <span className="text-sm text-slate-500 font-medium ml-1">
      {sortBy === "attendance" ? "%" : ""}
    </span>
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
      {sortBy === "attendance" ? "Attendance" : "Mid Avg"}
    </p>
  </div>
);

const PodiumCard = ({
  stat,
  sortBy,
  variant,
}: {
  stat: StudentStat;
  sortBy: SortBy;
  variant: PodiumVariant;
}) => {
  const v = VARIANTS[variant];
  const isGold = variant === "gold";

  return (
    <div className={`${CARD_BASE} ${v.card}`}>
      {isGold ? (
        <div className="absolute -top-6">
          <div className="relative">
            <div className="absolute inset-0 bg-yellow-500 blur-lg opacity-50 rounded-full"></div>
            <div className="relative w-14 h-14 rounded-full bg-gradient-to-b from-yellow-300 to-yellow-600 text-white flex items-center justify-center font-bold text-2xl shadow-xl shadow-yellow-500/40 ring-4 ring-[#0f1014]">
              {stat.rank}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`absolute -top-3 w-8 h-8 rounded-full text-white flex items-center justify-center font-bold text-sm ring-4 ring-[#0f1014] ${v.badge} ${
            stat.rank !== v.strikeWhenRank ? "line-through decoration-2" : ""
          }`}
        >
          {stat.rank}
        </div>
      )}

      <div
        className={`text-center w-full flex flex-col justify-between h-full ${
          isGold ? "mt-8" : "mt-4"
        }`}
      >
        {isGold && (
          <div className="mb-1" aria-hidden="true">
            <span className="text-3xl drop-shadow-md">👑</span>
          </div>
        )}
        <div
          className={
            isGold
              ? "flex-grow flex items-center justify-center mb-1"
              : "flex-1 flex items-center justify-center"
          }
        >
          <h3
            className={
              isGold
                ? "text-white font-extrabold text-xs md:text-base leading-snug line-clamp-3 w-full break-words px-1"
                : "text-slate-200 font-bold text-xs md:text-sm leading-tight line-clamp-2 px-1"
            }
          >
            {stat.name || stat.roll_no}
          </h3>
        </div>
        <div>
          {isGold ? (
            <>
              <p className="text-[10px] md:text-xs text-slate-400 mb-2 font-mono font-medium">
                {stat.roll_no}
              </p>
              <div className="bg-slate-900/50 rounded-xl p-1.5 md:p-2 w-full border border-white/5 shadow-inner">
                <ScoreStat stat={stat} sortBy={sortBy} />
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] text-slate-500 mb-2 font-mono">
                {stat.roll_no}
              </p>
              <ScoreStat stat={stat} sortBy={sortBy} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface PodiumProps {
  stats: StudentStat[];
  sortBy: SortBy;
}

export default function Podium({ stats, sortBy }: PodiumProps) {
  const [first, second, third] = stats;

  return (
    <div className="grid grid-cols-3 gap-3 mb-8 items-end">
      {second && (
        <div className="order-1 flex flex-col items-center">
          <PodiumCard stat={second} sortBy={sortBy} variant="silver" />
        </div>
      )}
      {first && (
        <div className="order-2 flex flex-col items-center z-10 w-full mb-4">
          <PodiumCard stat={first} sortBy={sortBy} variant="gold" />
        </div>
      )}
      {third && (
        <div className="order-3 flex flex-col items-center">
          <PodiumCard stat={third} sortBy={sortBy} variant="bronze" />
        </div>
      )}
      {first && first.rank === second?.rank && (
        <p className="col-span-3 order-4 text-center text-[11px] text-slate-500 mt-2">
          {stats.filter((s) => s.rank === first.rank).length} students tied at #
          {first.rank}
        </p>
      )}
    </div>
  );
}