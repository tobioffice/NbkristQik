import { formatScore } from "../format";
import type { SortBy, StudentStat } from "../api";

type MeritVariant = "first" | "second" | "third";

const ScoreStat = ({ stat, sortBy }: { stat: StudentStat; sortBy: SortBy }) => {
  const belowMinimum =
    sortBy === "attendance" && stat.attendance_percentage < 75;
  return (
    <span className={`merit-score${belowMinimum ? " is-below" : ""}`}>
      {formatScore(stat, sortBy)}
      {sortBy === "attendance" ? <span className="unit">%</span> : null}
      <span className="metric">
        {sortBy === "attendance" ? "Attendance" : "Mid Avg"}
      </span>
    </span>
  );
};

const MeritEntry = ({
  stat,
  sortBy,
  variant,
}: {
  stat: StudentStat;
  sortBy: SortBy;
  variant: MeritVariant;
}) => {
  // a tied rank shown on the second/third card is struck through in red ink
  const struck =
    (variant === "second" && stat.rank !== 2) ||
    (variant === "third" && stat.rank !== 3);

  return (
    <div className={`merit-entry merit-entry--${variant}`}>
      <span className={`merit-mark${struck ? " struck" : ""}`}>
        {stat.rank}
      </span>
      <h3 className="merit-name">{stat.name || stat.roll_no}</h3>
      <p className="merit-roll">{stat.roll_no}</p>
      <ScoreStat stat={stat} sortBy={sortBy} />
    </div>
  );
};

interface PodiumProps {
  stats: StudentStat[];
  sortBy: SortBy;
  /** Rows loaded right now, and the size of the whole ranked set. */
  loaded: number;
  total: number;
}

export default function Podium({ stats, sortBy, loaded, total }: PodiumProps) {
  const [first, second, third] = stats;

  // the tie note must not promise a count it cannot see: when the tie runs
  // off the end of the loaded page, say only that the rank is shared
  const tiedCount = first
    ? stats.filter((s) => s.rank === first.rank).length
    : 0;
  const tieTruncated = tiedCount === loaded && loaded < total;

  return (
    <div className="merit" aria-label="Top three in this view">
      {/* DOM order is 1-2-3 so a screen reader hears gold first; the grid
          places them 2-1-3 the way a podium is drawn */}
      {first && <MeritEntry stat={first} sortBy={sortBy} variant="first" />}
      {second && <MeritEntry stat={second} sortBy={sortBy} variant="second" />}
      {third && <MeritEntry stat={third} sortBy={sortBy} variant="third" />}
      {first && second && first.rank === second.rank && tiedCount > 1 && (
        <p className="merit-ties">
          {tieTruncated
            ? `Tied at #${first.rank}`
            : `${tiedCount} students tied at #${first.rank}`}
        </p>
      )}
    </div>
  );
}
