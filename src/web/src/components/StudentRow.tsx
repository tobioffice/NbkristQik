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

/**
 * One student in the Telegram-native register: a rank badge, a two-line
 * identity, and the figure on the right. No column headers, no rules.
 */
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
      className={`tg-row${isMe ? " tg-row--me" : ""}`}
    >
      <span
        className={`tg-rank-badge${
          stat.rank === 1 ? " tg-rank-badge--first" : ""
        }`}
      >
        {stat.rank}
      </span>
      <span className="tg-row__body">
        <span className="tg-row__title">
          {stat.hidden ? "Hidden student" : stat.name || stat.roll_no}
          {isMe && <span className="tg-you">YOU</span>}
        </span>
        <span className="tg-row__sub">
          {stat.hidden ? "Identity hidden" : stat.roll_no}
        </span>
      </span>
      <span className={`tg-row__score${belowMinimum ? " is-below" : ""}`}>
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
