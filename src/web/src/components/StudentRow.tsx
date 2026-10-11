import { formatScore } from "../format";
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
  const belowMinimum =
    sortBy === "attendance" && stat.attendance_percentage < 75;

  return (
    <div
      ref={isLast && lastElementRef ? lastElementRef : null}
      className={`reg-row${isMe ? " reg-row--me" : ""}`}
    >
      <span className="reg-row__rank">{stat.rank}</span>
      <span className="reg-row__roll">{stat.roll_no}</span>
      <h3 className="reg-row__name">
        {stat.name || stat.roll_no}
        {isMe && <span className="you-stamp">YOU</span>}
      </h3>
      <span
        className={`reg-row__score${belowMinimum ? " is-below" : ""}`}
      >
        {formatScore(stat, sortBy)}
        {sortBy === "attendance" ? <span className="unit">%</span> : null}
      </span>
    </div>
  );
}
