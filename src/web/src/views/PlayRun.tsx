import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerDailyRun,
  startDailyRun,
  type FiveFeedback,
  type FiveQuestion,
  type FiveResult,
} from "../api";
import { SkeletonRows } from "../components/FeedbackStates";
import { RequestError } from "../http";
import { haptic, useClosingConfirmation } from "../telegram";
import { useTelegramIdentity } from "../useTelegramIdentity";

/**
 * Today's run, played inside the Mini App.
 *
 * The bot still runs its own chat copy: both surfaces read and write the same
 * attempt, so a run started here resumes in the chat and the other way round.
 * The server owns the clock and the answers; this screen only draws the prompt,
 * counts the ten seconds down, and hands each pick back.
 *
 * The correct option never reaches the browser, and the score shown after each
 * answer is the server's own figure, so a modified client cannot pick its way
 * up the board.
 */

const LETTERS = ["A", "B", "C", "D"];

const formatPoints = (value: number): string => value.toLocaleString("en-IN");

const noop = (): void => undefined;

export type PlayView =
  | { kind: "loading" }
  | { kind: "needs-telegram" }
  | { kind: "needs-roll" }
  | { kind: "not-ready" }
  | { kind: "error" }
  | {
      kind: "playing";
      attemptId: number;
      score: number;
      question: FiveQuestion;
      remainingMs: number;
      feedback: FiveFeedback | null;
    }
  | { kind: "done"; result: FiveResult; alreadyPlayed: boolean };

export interface PlayRunViewProps {
  view: PlayView;
  busy?: boolean;
  notice?: string | null;
  onChoose?: (option: number) => void;
  onRetry?: () => void;
  onHome?: () => void;
  onBoard?: () => void;
}

const Head = ({ title, note }: { title: string; note?: string }) => (
  <div className="page-head">
    <h2 className="page-title">{title}</h2>
    {note ? <p className="page-note">{note}</p> : null}
  </div>
);

const ResultRow = ({ label, value }: { label: string; value: string }) => (
  <div className="profile-row">
    <span className="profile-row__label">{label}</span>
    <span className="profile-row__value">{value}</span>
  </div>
);

/** The run screen, without the fetch: one shape per state, testable alone. */
export const PlayRunView = ({
  view,
  busy = false,
  notice = null,
  onChoose = noop,
  onRetry = noop,
  onHome = noop,
  onBoard = noop,
}: PlayRunViewProps) => {
  if (view.kind === "loading") {
    return (
      <div className="page">
        <Head title="Today's run" />
        <div className="page-body">
          <SkeletonRows rows={4} />
        </div>
      </div>
    );
  }

  if (view.kind === "needs-telegram") {
    return (
      <div className="page">
        <Head title="Today's run" />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <p className="title">Open this inside Telegram</p>
              <p className="sub">The run is tied to your Telegram account.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view.kind === "needs-roll") {
    return (
      <div className="page">
        <Head title="Today's run" />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <p className="title">Save your roll to play</p>
              <p className="sub">The run needs your roll number and section.</p>
            </div>
            <button type="button" className="btn-ink w-full" onClick={onHome}>
              Open profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view.kind === "not-ready") {
    return (
      <div className="page">
        <Head title="Today's run" />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <p className="title">The set isn&rsquo;t ready yet</p>
              <p className="sub">Try again in a few minutes.</p>
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

  if (view.kind === "error") {
    return (
      <div className="page">
        <Head title="Today's run" />
        <div className="page-body">
          <div className="form-block">
            <div className="state-block">
              <p className="title">The run didn&rsquo;t load</p>
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

  if (view.kind === "done") {
    const { result } = view;
    return (
      <div className="page">
        <Head
          title="Run done"
          note={`${result.correct} of ${result.total} correct.`}
        />
        <div className="page-body">
          <div className="form-block">
            <div className="profile-group run-result">
              <ResultRow label="Run score" value={formatPoints(result.score)} />
              <ResultRow
                label="Season points"
                value={formatPoints(result.points)}
              />
              <ResultRow
                label="Today"
                value={
                  result.players <= 1
                    ? "First"
                    : `#${result.rank} of ${result.players}`
                }
              />
              {result.streak > 1 ? (
                <ResultRow
                  label="Best streak"
                  value={`${result.streak} correct in a row`}
                />
              ) : null}
              {result.section ? (
                <ResultRow
                  label="Section"
                  value={`${result.section.label} · #${result.section.rank} of ${result.section.total}`}
                />
              ) : null}
            </div>
            {!result.section ? (
              <p className="hint-line">
                No section on record. This run counts for you only.
              </p>
            ) : null}
            {view.alreadyPlayed ? (
              <p className="hint-line">Played today. Back tomorrow.</p>
            ) : null}
          </div>
          <div className="form-block btn-row">
            <button type="button" className="btn-ink" onClick={onBoard}>
              See the board
            </button>
            <button type="button" className="btn-outline" onClick={onHome}>
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { question, score, remainingMs, feedback } = view;
  const expired = remainingMs <= 0;
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const left = Math.max(
    0,
    Math.min(100, (remainingMs / question.limitMs) * 100),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="head-row">
          <h2 className="page-title">
            Question {question.index + 1} of {question.total}
          </h2>
          <span
            className={`run-clock${expired ? " run-clock--out" : ""}`}
            role="timer"
            aria-live="off"
          >
            {expired ? "Time's up" : `${seconds}s`}
          </span>
        </div>
        <p className="page-note run-line">
          <span className="run-score">Score {formatPoints(score)}</span>
          {feedback ? (
            <span
              className={`run-feedback${
                feedback.timedOut
                  ? " run-feedback--timeout"
                  : feedback.correct
                    ? " run-feedback--correct"
                    : ""
              }`}
            >
              {feedback.timedOut
                ? "Too slow"
                : feedback.correct
                  ? `Correct +${formatPoints(feedback.earned)}`
                  : "Missed"}
            </span>
          ) : null}
        </p>
        <div className="run-progress" aria-hidden="true">
          <i style={{ width: `${left}%` }} />
        </div>
      </div>

      <div className="page-body">
        {notice ? (
          <div className="form-block">
            <p className="run-notice" role="alert">
              {notice}
            </p>
          </div>
        ) : null}

        <p className="run-question">{question.prompt}</p>

        <div className="tg-group run-options" role="group" aria-label="Answers">
          {question.options.map((option, index) => (
            <button
              key={`${index}-${option}`}
              type="button"
              className="tg-row run-option"
              disabled={busy}
              onClick={() => onChoose(index)}
            >
              <span className="run-option__letter" aria-hidden="true">
                {LETTERS[index] ?? index + 1}
              </span>
              <span className="tg-row__body">
                <span className="tg-row__title run-option__label">
                  {option}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

type Load =
  | { kind: "loading" }
  | { kind: "needs-telegram" }
  | { kind: "needs-roll" }
  | { kind: "not-ready" }
  | { kind: "error" }
  | {
      kind: "playing";
      attemptId: number;
      score: number;
      question: FiveQuestion;
      feedback: FiveFeedback | null;
    }
  | { kind: "done"; result: FiveResult; alreadyPlayed: boolean };

export default function PlayRun() {
  const { tgUser, initData } = useTelegramIdentity();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [remainingMs, setRemainingMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attemptNo, setAttemptNo] = useState(0);

  useEffect(() => {
    if (!tgUser) return;

    const controller = new AbortController();

    startDailyRun({ userId: tgUser, initData }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.state === "playing") {
          setLoad({
            kind: "playing",
            attemptId: res.attemptId,
            score: res.score,
            question: res.question,
            feedback: null,
          });
          setRemainingMs(res.question.limitMs);
          return;
        }
        if (res.state === "done") {
          setLoad({
            kind: "done",
            result: res.result,
            alreadyPlayed: res.alreadyPlayed,
          });
          return;
        }
        setLoad({ kind: res.state });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ kind: "error" });
      });

    return () => controller.abort();
  }, [tgUser, initData, attemptNo]);

  // The server starts the clock when it hands the question over; the bar only
  // mirrors that window. A new question (a new object) restarts it.
  const question = load.kind === "playing" ? load.question : null;
  const deadline = useRef(0);
  useEffect(() => {
    if (!question) return;
    deadline.current = Date.now() + question.limitMs;
    const timer = setInterval(() => {
      setRemainingMs(Math.max(0, deadline.current - Date.now()));
    }, 100);
    return () => clearInterval(timer);
  }, [question]);

  const choose = useCallback(
    async (option: number) => {
      if (load.kind !== "playing" || busy) return;
      haptic.tap();
      setBusy(true);
      setNotice(null);

      try {
        const res = await answerDailyRun(
          { userId: tgUser ?? undefined, initData },
          load.attemptId,
          load.question.index,
          option,
        );
        if (res.state === "playing") {
          setLoad({
            kind: "playing",
            attemptId: res.attemptId,
            score: res.score,
            question: res.question,
            feedback: res.feedback,
          });
          setRemainingMs(res.question.limitMs);
        } else {
          setLoad({
            kind: "done",
            result: res.result,
            alreadyPlayed: res.alreadyPlayed,
          });
        }
      } catch (e) {
        if (e instanceof RequestError && e.status === 409) {
          // The run moved on in another tab or in the chat; read it again.
          setNotice("That question already moved on.");
          setLoad({ kind: "loading" });
          setAttemptNo((n) => n + 1);
          return;
        }
        setNotice("That answer didn't send. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [load, busy, tgUser, initData],
  );

  const go = useCallback((hash: string) => {
    haptic.select();
    window.location.hash = hash;
  }, []);

  const retry = useCallback(() => {
    setNotice(null);
    setLoad({ kind: "loading" });
    setAttemptNo((n) => n + 1);
  }, []);

  useClosingConfirmation(load.kind === "playing");

  return (
    <PlayRunView
      view={
        !tgUser
          ? { kind: "needs-telegram" }
          : load.kind === "playing"
            ? { ...load, remainingMs }
            : load
      }
      busy={busy}
      notice={notice}
      onChoose={(option) => void choose(option)}
      onRetry={retry}
      onHome={() => go("#/")}
      onBoard={() => go("#/games")}
    />
  );
}
