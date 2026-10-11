import { formatScore } from "../format";
import type { SortBy, StudentStat } from "../api";

type MeritVariant = "first" | "second" | "third";

const ORDER: Record<MeritVariant, string> = {
  second: "order-1",
  first: "order-2",
  third: "order-3",
};

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
  const isFirst = variant === "first";
  // a tied rank shown on the second/third card is struck through in red ink
  const struck =
    (variant === "second" && stat.rank !== 2) ||
    (variant === "third" && stat.rank !== 3);

  return (
    <div
      className={`merit-entry${isFirst ? " merit-entry--first" : ""} ${ORDER[variant]}`}
    >
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
}

export default function Podium({ stats, sortBy }: PodiumProps) {
  const [first, second, third] = stats;

  return (
    <div className="merit">
      {second && (
        <MeritEntry stat={second} sortBy={sortBy} variant="second" />
      )}
      {first && <MeritEntry stat={first} sortBy={sortBy} variant="first" />}
      {third && <MeritEntry stat={third} sortBy={sortBy} variant="third" />}
      {first && first.rank === second?.rank && (
        <p className="merit-ties">
          {stats.filter((s) => s.rank === first.rank).length} students tied at #
          {first.rank}
        </p>
      )}
    </div>
  );
}
