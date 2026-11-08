import { useCallback, useEffect, useState } from "react";
import {
  fetchMyAcademics,
  type AcademicFreshness,
  type AttendanceData,
} from "../api";
import { useBandStamp } from "../bandStamp";
import { bunkPlan, formatGap } from "../format";
import { useIdentity } from "../identity";
import { useTelegramIdentity } from "../useTelegramIdentity";

/**
 * The first screen: the student's own attendance, read off the register.
 *
 * The shell owns the band, so this view publishes the overall percentage as
 * its stamp. Every state is explicit — checking, outside Telegram, no saved
 * roll, a failed check, and the figures — because "no roll" and "the check
 * failed" are different answers and must not look alike.
 */

interface MyAttendanceProps {
  /** Opens the issue desk; the shell owns navigation. */
  onReport: () => void;
  /** Opens Profile so an unregistered student can save a roll. */
  onProfile: () => void;
}

type AttendanceState =
  | { state: "loading" }
  | { state: "unregistered" }
  | { state: "ready"; data: AttendanceData; freshness: AcademicFreshness }
  | { state: "error"; message: string };

export default function MyAttendance({
  onReport,
  onProfile,
}: MyAttendanceProps) {
  const identity = useIdentity();
  const { tgUser, initData } = useTelegramIdentity();
  const [state, setState] = useState<AttendanceState>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (identity.status !== "ready") return;

    const controller = new AbortController();
    setState({ state: "loading" });

    fetchMyAcademics(
      { userId: tgUser ?? undefined, initData },
      "attendance",
      {
        signal: controller.signal,
        // an explicit Refresh must not be answered by the 60 s browser copy
        cache: attempt > 0 ? "no-store" : "default",
      },
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!response.ok || !response.registered) {
          setState({ state: "unregistered" });
          return;
        }
        setState({
          state: "ready",
          data: response.data,
          freshness: response.freshness,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not load your attendance.",
        });
      });

    return () => controller.abort();
  }, [identity.status, identity.roll, tgUser, initData, attempt]);

  const stamp =
    state.state === "ready"
      ? {
          value: `${state.data.percentage.toFixed(1)}%`,
          label: "attendance",
        }
      : null;
  useBandStamp(stamp);

  if (identity.status === "loading") {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">My attendance</p>
          <h2 className="page-title">Checking your roll...</h2>
        </div>
        <div className="page-body">
          <p className="hint-line" role="status" style={{ padding: "0 16px" }}>
            Asking the register for your saved roll.
          </p>
          <div className="form-block" aria-hidden="true">
            <div className="sk" style={{ height: 96, marginTop: 16 }} />
            <div className="sk" style={{ height: 44, marginTop: 14 }} />
            <div className="sk" style={{ height: 44, marginTop: 10 }} />
          </div>
        </div>
      </div>
    );
  }

  if (identity.status === "anonymous") {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">My attendance</p>
          <h2 className="page-title">Open this from Telegram</h2>
          <p className="page-note">
            Your attendance belongs to the Telegram account that saved the
            roll. Open the NbkristQik bot and tap My attendance.
          </p>
        </div>
      </div>
    );
  }

  if (identity.status === "error") {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">My attendance</p>
          <h2 className="page-title">Couldn&rsquo;t check your roll</h2>
          <p className="page-note">
            {identity.error ??
              "The register did not answer. Check your connection and try again."}
          </p>
        </div>
        <div className="page-body">
          <div className="form-block">
            <button className="btn-outline w-full" onClick={identity.refresh}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (identity.status === "no-roll" || state.state === "unregistered") {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">My attendance</p>
          <h2 className="page-title">No roll saved</h2>
          <p className="page-note">
            Save your roll number once and this page opens with your own
            attendance, no roll to type.
          </p>
        </div>
        <div className="page-body">
          <div className="form-block">
            <button className="btn-ink w-full" onClick={onProfile}>
              Save your roll
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rank = identity.ranks?.attendance ?? null;

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">My attendance</p>
        <div className="head-row">
          <h2 className="page-title">This semester</h2>
          <button
            className="btn-outline btn-sm"
            onClick={load}
            disabled={state.state === "loading"}
          >
            {state.state === "loading" ? "Checking..." : "Refresh"}
          </button>
        </div>
        <p className="page-note">
          {state.state === "ready"
            ? state.data.year_branch_section
            : "Your own attendance, read from the saved roll."}
        </p>
      </div>

      <div className="page-body">
        <div className="att-id">
          <span>
            Reading as <b>{identity.roll}</b>
          </span>
          <span className="att-id__rank">
            {rank ? (
              <>
                #{rank.rank} <small>of {rank.total.toLocaleString()}</small>
              </>
            ) : (
              "Not ranked yet"
            )}
          </span>
        </div>

        {state.state === "loading" ? (
          <div className="form-block" aria-hidden="true">
            <div className="sk" style={{ height: 96, marginTop: 4 }} />
            <div className="sk" style={{ height: 44, marginTop: 14 }} />
            <div className="sk" style={{ height: 44, marginTop: 10 }} />
            <div className="sk" style={{ height: 44, marginTop: 10 }} />
          </div>
        ) : state.state === "error" ? (
          <div className="form-block">
            <p className="note note--err" role="alert">
              {state.message}
            </p>
            <button className="btn-outline w-full mt-4" onClick={load}>
              Try again
            </button>
          </div>
        ) : (
          <AttendanceFigures
            data={state.data}
            freshness={state.freshness}
            onReport={onReport}
          />
        )}
      </div>
    </div>
  );
}

/** The figures once the endpoint has answered. */
function AttendanceFigures({
  data,
  freshness,
  onReport,
}: {
  data: AttendanceData;
  freshness: AcademicFreshness;
  onReport: () => void;
}) {
  const { attended, conducted } = data.totalClasses;
  const plan = bunkPlan(attended, conducted);
  const below = data.percentage < 75;

  const headline =
    plan.skips > 0
      ? `You can bunk ${plan.skips} more ${
          plan.skips === 1 ? "class" : "classes"
        } and stay above 75%.`
      : plan.needed > 0
        ? `Go to the next ${plan.needed} ${
            plan.needed === 1 ? "class" : "classes"
          } in a row to get back to 75%.`
        : "You're right at 75%. Go to everything.";

  return (
    <>
      <div className="att-summary">
        <div className="att-summary__big">
          <span className="att-summary__label">Overall</span>
          <span className="att-summary__percent">
            {data.percentage.toFixed(2)}
            <small>%</small>
          </span>
          <span
            className={
              below ? "att-summary__gap is-below" : "att-summary__gap"
            }
          >
            {formatGap(data.percentage)}
          </span>
        </div>
        <dl className="att-summary__facts">
          <div>
            <dt>Attended</dt>
            <dd>{attended}</dd>
          </div>
          <div>
            <dt>Conducted</dt>
            <dd>{conducted}</dd>
          </div>
        </dl>
      </div>

      <p
        className={
          freshness.source === "fallback"
            ? "att-fresh att-fresh--warn"
            : "att-fresh"
        }
        role="status"
      >
        {freshnessLine(freshness)}
      </p>

      <div className={below ? "att-bunk is-below" : "att-bunk"}>
        <p>{headline}</p>
        <span>The plan for {data.year_branch_section}</span>
      </div>

      {data.subjects.length === 0 ? (
        <div className="form-block">
          <p className="form-note">
            The portal has no subject rows for this roll yet.
          </p>
        </div>
      ) : (
        <div className="att-table">
          <div className="att-table__head" aria-hidden="true">
            <span>Subject</span>
            <span>Att/Total</span>
            <span>Now</span>
            <span>Last</span>
          </div>
          {data.subjects.map((subject, index) => {
            const percentage =
              subject.conducted > 0
                ? (subject.attended / subject.conducted) * 100
                : null;
            const subjectBelow = percentage !== null && percentage < 75;

            return (
              <div
                className={subjectBelow ? "att-row att-row--below" : "att-row"}
                key={`${subject.subject}-${index}`}
              >
                <span className="att-row__name">{subject.subject}</span>
                <span className="att-row__count">
                  {subject.attended}/{subject.conducted}
                </span>
                <span className="att-row__pct">
                  {percentage === null ? "—" : `${Math.round(percentage)}%`}
                </span>
                <span className="att-row__last">
                  {subject.lastUpdated?.trim() || "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button className="foot-link" onClick={onReport}>
        Report wrong data
      </button>
    </>
  );
}

/** The server's freshness notice, or the truth when it has none. */
const freshnessLine = (freshness: AcademicFreshness): string => {
  if (freshness.notice) return freshness.notice;
  if (freshness.source === "live") return "Checked just now";
  if (freshness.source === "fallback") return "Showing the last saved copy.";
  return "From a recent check.";
};
