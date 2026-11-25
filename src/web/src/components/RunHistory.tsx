import type { GameRun } from "../api";
import { runDayLabel } from "../format";

/**
 * The profile's finished daily runs.
 *
 * A run is one line: the IST day, how many were right and the run's score,
 * with the season points it paid at the right edge. Newest first, ten at
 * most; a student with none gets the way into today's run instead of an
 * empty block.
 */

const formatNumber = (value: number): string => value.toLocaleString("en-IN");

export const RunHistory = ({ runs }: { runs: GameRun[] }) => (
  <div className="form-block" id="runs">
    <div className="run-head">
      <h3 className="run-title">Your runs</h3>
      {runs.length > 0 ? (
        <span className="run-count">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      ) : null}
    </div>

    {runs.length === 0 ? (
      <p className="profile-hint">
        No runs yet.{" "}
        <a className="link-btn" href="#/play">
          Play today&rsquo;s run
        </a>
        .
      </p>
    ) : (
      <div className="run-group">
        {runs.map((run) => (
          <div className="run-row" key={run.id}>
            <span className="run-row__body">
              <span className="run-row__title">{runDayLabel(run.dayKey)}</span>
              <span className="run-row__meta">
                {run.correct} of {run.total} correct · {formatNumber(run.score)}{" "}
                score
              </span>
            </span>
            <span className="run-row__points">
              {formatNumber(run.points)}
              <span className="run-row__unit"> pts</span>
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default RunHistory;
