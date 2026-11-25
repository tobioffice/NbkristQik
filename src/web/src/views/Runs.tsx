import { useEffect, useState } from "react";
import { getGameRuns, type GameRunDetail, type GameRunQuestion } from "../api";
import { SkeletonRows } from "../components/FeedbackStates";
import { runDayLabel } from "../format";
import { useTelegramIdentity } from "../useTelegramIdentity";

/**
 * The caller's finished runs, question by question.
 *
 * The home banner's "Your runs" action opens this page. Each run is one
 * expandable card (the newest starts open): the run's figures on the closed
 * row, then every question with the answer given, whether it was right, how
 * long it took and what it was worth. A retired question still shows the
 * attempt with a placeholder.
 */

type RunsViewState =
  | { kind: "loading" }
  | { kind: "needs-telegram" }
  | { kind: "error" }
  | { kind: "ready"; runs: GameRunDetail[] };

export interface RunsViewProps {
  view: RunsViewState;
  /** The run to open first, from #/runs/<id>; the newest when absent. */
  selectedRun?: string | null;
  onRetry?: () => void;
}

const formatNumber = (value: number): string => value.toLocaleString("en-IN");

const LETTERS = ["A", "B", "C", "D"];

const letter = (index: number | null): string =>
  index == null ? "—" : (LETTERS[index] ?? String(index + 1));

const optionText = (question: GameRunQuestion, index: number | null): string =>
  index == null ? "" : (question.options[index] ?? "");

const answerTime = (ms: number | null): string => {
  if (ms == null) return "—";
  if (ms > 10_000) return "timeout";
  return `${(ms / 1000).toFixed(1)}s`;
};

const runDuration = (ms: number | null): string => {
  if (ms == null) return "—";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest < 10 ? "0" : ""}${rest}s`;
};

const Head = ({ runs }: { runs?: number }) => (
  <div className="page-head">
    <h2 className="page-title">Your runs</h2>
    <p className="page-note">
      Every finished daily run, newest first.
      {runs != null ? ` ${runs} ${runs === 1 ? "run" : "runs"}.` : ""} Tap a run
      for its questions.
    </p>
  </div>
);

const AnswerRow = ({ question }: { question: GameRunQuestion }) => {
  const answered = question.chosenIndex != null;
  const right = question.correct === true;
  return (
    <div className="answer-row">
      <p className="answer-prompt">
        {question.index}. {question.prompt}
      </p>
      <p className="answer-meta">
        <span
          className={
            answered ? (right ? "answer-ok" : "answer-bad") : "answer-quiet"
          }
        >
          {answered ? (right ? "Correct" : "Wrong") : "Not answered"}
        </span>
        {answered ? (
          <>
            {" · chose "}
            {letter(question.chosenIndex)}.{" "}
            {optionText(question, question.chosenIndex)}
          </>
        ) : null}
        {" · "}
        {answerTime(question.ms)}
        {question.points != null
          ? ` · ${formatNumber(question.points)} pts`
          : ""}
      </p>
      {answered &&
      question.correct === false &&
      question.correctIndex != null ? (
        <p className="answer-fix">
          Correct: {letter(question.correctIndex)}.{" "}
          {optionText(question, question.correctIndex)}
        </p>
      ) : null}
    </div>
  );
};

export const RunsView = ({ view, selectedRun, onRetry }: RunsViewProps) => {
  if (view.kind === "loading") {
    return (
      <div className="page">
        <Head />
        <div className="page-body">
          <SkeletonRows rows={4} />
        </div>
      </div>
    );
  }

  if (view.kind === "needs-telegram") {
    return (
      <div className="page">
        <Head />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <p className="title">Open this inside Telegram</p>
              <p className="sub">
                Your runs are tied to your Telegram account.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <div className="page">
        <Head />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <p className="title">Could not load your runs</p>
              <p className="sub">Check your connection and try again.</p>
            </div>
            <button
              type="button"
              className="btn-outline w-full"
              onClick={onRetry}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { runs } = view;
  const openId =
    selectedRun && runs.some((run) => String(run.id) === selectedRun)
      ? selectedRun
      : runs[0]
        ? String(runs[0].id)
        : null;

  return (
    <div className="page">
      <Head runs={runs.length > 0 ? runs.length : undefined} />
      <div className="page-body">
        {runs.length === 0 ? (
          <div className="form-block">
            <div className="state-block">
              <p className="title">No runs yet</p>
              <p className="sub">Today&rsquo;s run is waiting.</p>
            </div>
            <a className="btn-ink w-full" href="#/play">
              Play today&rsquo;s run
            </a>
          </div>
        ) : (
          <div className="form-block">
            <div className="runs-list">
              {runs.map((run) => (
                <details
                  className="run-card"
                  key={run.id}
                  open={String(run.id) === openId}
                >
                  <summary className="run-card__head">
                    <span className="run-card__body">
                      <span className="run-card__day">
                        {runDayLabel(run.dayKey)}
                      </span>
                      <span className="run-card__meta">
                        {run.correct} of {run.total} correct ·{" "}
                        {formatNumber(run.score)} score
                        {run.streak > 1 ? ` · best ${run.streak} in a row` : ""}
                        {run.durationMs != null
                          ? ` · ${runDuration(run.durationMs)}`
                          : ""}
                      </span>
                    </span>
                    <span className="run-card__points">
                      {formatNumber(run.points)}
                      <span className="run-card__unit"> pts</span>
                    </span>
                  </summary>
                  <div className="run-card__questions">
                    {run.questions.map((question) => (
                      <AnswerRow question={question} key={question.index} />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function Runs({
  selectedRun = null,
}: {
  selectedRun?: string | null;
}) {
  const { tgUser, initData } = useTelegramIdentity();
  const [view, setView] = useState<RunsViewState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!tgUser) {
      setView({ kind: "needs-telegram" });
      return;
    }

    const controller = new AbortController();
    setView({ kind: "loading" });
    getGameRuns({ userId: tgUser, initData }, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) {
          setView({ kind: "ready", runs: answer.runs });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setView({ kind: "error" });
      });

    return () => controller.abort();
  }, [tgUser, initData, attempt]);

  return (
    <RunsView
      view={view}
      selectedRun={selectedRun}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
