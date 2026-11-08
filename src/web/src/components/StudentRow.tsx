import { memo } from "react";
import { formatScore } from "../format";
import type { SortBy, StudentStat } from "../api";

interface StudentRowProps {
  stat: StudentStat;
  sortBy: SortBy;
  isMe: boolean;
  isLast: boolean;
  lastElementRef?: (node: HTMLLIElement) => void;
}

const StudentRow = ({
  stat,
  sortBy,
  isMe,
  isLast,
  lastElementRef,
}: StudentRowProps) => {
  const belowMinimum =
    sortBy === "attendance" && stat.attendance_percentage < 75;

  return (
    <li
      ref={isLast && lastElementRef ? lastElementRef : null}
      className={`reg-row${isMe ? " reg-row--me" : ""}`}
    >
      <span className="reg-row__rank">{stat.rank}</span>
      <span className="reg-row__roll">{stat.roll_no}</span>
      {/* a name is not a heading: hundreds of h3s make the register
          unnavigable for a screen reader */}
      <span className="reg-row__name">
        {stat.name || stat.roll_no}
        {isMe && <span className="you-stamp">YOU</span>}
      </span>
      <span className={`reg-row__score${belowMinimum ? " is-below" : ""}`}>
        {formatScore(stat, sortBy)}
        {sortBy === "attendance" ? <span className="unit">%</span> : null}
      </span>
    </li>
  );
};

/**
 * Appending a page keeps the earlier row objects, so only the rows that
 * arrived should draw. `lastElementRef` is only read by the last row; a new
 * callback on every page must not redraw the register above it.
 */
export default memo(
  StudentRow,
  (prev, next) =>
    prev.stat === next.stat &&
    prev.sortBy === next.sortBy &&
    prev.isMe === next.isMe &&
    prev.isLast === next.isLast &&
    (!next.isLast || prev.lastElementRef === next.lastElementRef),
);
