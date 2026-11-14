import { formatScore } from "../format";
import type { SortBy, StudentStat } from "../api";

const MeritScore = ({
  stat,
  sortBy,
}: {
  stat: StudentStat;
  sortBy: SortBy;
}) => {
  const belowMinimum =
    sortBy === "attendance" && stat.attendance_percentage < 75;
  return (
    <span className={`tg-row__score${belowMinimum ? " is-below" : ""}`}>
      {formatScore(stat, sortBy)}
      {sortBy === "attendance" ? <span className="unit">%</span> : null}
    </span>
  );
};

const MeritRow = ({ stat, sortBy }: { stat: StudentStat; sortBy: SortBy }) => {
  const first = stat.rank === 1;
  return (
    <div className={`tg-row${first ? " tg-row--first" : ""}`}>
      <span
        className={`tg-rank-badge${first ? " tg-rank-badge--first" : ""}`}
      >
        {stat.rank}
      </span>
      <span className="tg-row__body">
        <span className="tg-row__title">
          {stat.hidden ? "Hidden student" : stat.name || stat.roll_no}
        </span>
        <span className="tg-row__sub">
          {stat.hidden ? "Identity hidden" : stat.roll_no}
        </span>
      </span>
      <MeritScore stat={stat} sortBy={sortBy} />
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

/**
 * The top three as three ordinary Telegram rows, in rank order. The first
 * row carries the filled blue badge; the other two stay quiet.
 */
export default function Podium({ stats, sortBy, loaded, total }: PodiumProps) {
  const [first, second, third] = stats;

  // the tie note must not promise a count it cannot see: when the tie runs
  // off the end of the loaded page, say only that the rank is shared
  const tiedCount = first
    ? stats.filter((s) => s.rank === first.rank).length
    : 0;
  const tieTruncated = tiedCount === loaded && loaded < total;

  return (
    <>
      <div className="tg-group" aria-label="Top three in this view">
        {first && <MeritRow stat={first} sortBy={sortBy} />}
        {second && <MeritRow stat={second} sortBy={sortBy} />}
        {third && <MeritRow stat={third} sortBy={sortBy} />}
      </div>
      {first && second && first.rank === second.rank && tiedCount > 1 && (
        <p className="tg-tie">
          {tieTruncated
            ? `Tied at #${first.rank}`
            : `${tiedCount} students tied at #${first.rank}`}
        </p>
      )}
    </>
  );
}
