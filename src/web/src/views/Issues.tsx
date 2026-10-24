import { useEffect, useState } from "react";
import { submitReport, fetchMyReports, type MyReport } from "../api";
import {
  FORM_ROUTE,
  HISTORY_ROUTE,
  type IssuesRoute,
} from "../issuesRoute";
import ReportThreadView from "./ReportThread";

/**
 * The issue desk: file a report, then keep the conversation going.
 *
 * Every report is a thread — the admin answers from the panel, the reply
 * arrives here and in Telegram, and either side can add to it.
 *
 * This view is pure: the route in and the route out come from the caller, so
 * the same screens work as the standalone report page (query-string routes)
 * and as the app's Issues tab (hash routes).
 */

interface IssuesProps {
  identity: { userId?: string; initData?: string };
  route: IssuesRoute;
  onNavigate: (route: IssuesRoute) => void;
  /** Publishes the number of open reports, for the band stamp. */
  onOpenCount?: (count: number | null) => void;
  /**
   * Draw the screens' own headings and actions. Off inside the app, where the
   * printed page head already says which screen this is and carries the action.
   */
  showTitle?: boolean;
}

export default function Issues({
  identity,
  route,
  onNavigate,
  onOpenCount,
  showTitle = true,
}: IssuesProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingError, setLoadingError] = useState(false);

  const loadReports = () => {
    if (!identity.userId) return;
    setLoadingReports(true);
    setLoadingError(false);
    fetchMyReports(identity)
      .then((rows) => {
        setReports(rows);
        onOpenCount?.(rows.filter((row) => row.status !== "resolved").length);
      })
      .catch(() => setLoadingError(true))
      .finally(() => setLoadingReports(false));
  };

  // every visit to the list refetches: a reply may have arrived in chat since
  // the last look, and a stale "unread" badge is worse than a short spinner
  useEffect(() => {
    if (route.view !== "history") return;
    loadReports();
    // deliberate: only on view switches, never on state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view]);

  const send = async () => {
    setError(null);
    const clean = message.trim();
    if (clean.length < 10 || clean.length > 1000) {
      setError("Give me a bit more detail: between 10 and 1000 characters.");
      return;
    }
    setSending(true);
    try {
      const { issueId } = await submitReport(identity, clean);
      setTicket(issueId);
      setMessage("");
      setReports(null); // the list refetches on its next visit
    } catch (e) {
      setError((e as Error).message || "Could not send the report.");
    } finally {
      setSending(false);
    }
  };

  if (route.view === "thread" && route.issue) {
    return (
      <ReportThreadView
        identity={identity}
        issueId={route.issue}
        seed={reports?.find((row) => row.issueId === route.issue) ?? null}
        onBack={() => onNavigate(HISTORY_ROUTE)}
        onNewReport={() => onNavigate(FORM_ROUTE)}
      />
    );
  }

  if (route.view === "history") {
    return (
      <div className="form-block">
        {showTitle ? (
          <div className="head-row">
            <h2 className="form-title">My reports</h2>
            <button
              onClick={() => onNavigate(FORM_ROUTE)}
              className="btn-outline btn-sm"
            >
              New report
            </button>
          </div>
        ) : null}

        {loadingReports && (
          <div aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="sk" style={{ height: 72, marginTop: 12 }} />
            ))}
          </div>
        )}

        {loadingError && (
          <p className="form-note mt-4">
            That didn't load.{" "}
            <button onClick={loadReports} className="link-btn">
              Retry
            </button>
          </p>
        )}

        {reports && reports.length === 0 && (
          <p className="form-note mt-4">
            No reports yet. Anything you send shows up here with its status.
          </p>
        )}

        {reports && reports.length > 0 && (
          <ul className="report-list">
            {reports.map((report) => (
              <li key={report.issueId} className="report-entry">
                <button
                  onClick={() =>
                    onNavigate({ view: "thread", issue: report.issueId })
                  }
                  className="report-entry__open"
                  aria-label={`Open thread ${report.issueId}`}
                >
                  <span className="report-entry__head">
                    <span className="issue-id">{report.issueId}</span>
                    <span className="report-entry__marks">
                      {report.unread > 0 && (
                        <span className="report-entry__new">
                          {report.unread} new
                        </span>
                      )}
                      <span
                        className={`status-mark status-mark--${report.status}`}
                      >
                        <i aria-hidden="true" />
                        {report.status}
                      </span>
                    </span>
                  </span>
                  <span className="report-entry__msg">{report.message}</span>
                  {report.adminReply && (
                    <span className="report-entry__reply">
                      <b>reply from the admin</b>
                      {report.adminReply}
                    </span>
                  )}
                  <span className="report-entry__foot">
                    {report.messageCount > 1
                      ? `${report.messageCount} messages`
                      : "1 message"}
                    {" · "}
                    {report.lastAuthor === "admin"
                      ? "admin wrote last"
                      : "you wrote last"}
                    <span aria-hidden="true"> →</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="form-block">
      {ticket ? (
        <>
          <div className="ticket">
            <p className="ticket__label">Report received</p>
            <p className="ticket__id">{ticket}</p>
            <p className="ticket__note">
              Keep this id for follow-ups. The reply lands in your Telegram chat
              and on this thread.
            </p>
          </div>
          <div className="btn-row">
            <button
              onClick={() => onNavigate({ view: "thread", issue: ticket })}
              className="btn-ink"
            >
              Open thread
            </button>
            <button onClick={() => setTicket(null)} className="btn-outline">
              Report another
            </button>
          </div>
          <p className="form-note mt-4">
            <button
              onClick={() => {
                setTicket(null);
                onNavigate(HISTORY_ROUTE);
              }}
              className="link-btn"
            >
              All my reports
            </button>
          </p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          noValidate
        >
          {showTitle ? (
            <p className="form-note">
              Describe what went wrong. You'll get an issue id to track it, and
              the reply lands in your Telegram chat.
            </p>
          ) : null}

          <label className="field">
            <span>What happened?</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={1000}
              placeholder="Marks are showing wrong for my roll. The portal says 22 but the bot shows 13."
            />
            <span className="char-count">{message.length}/1000</span>
          </label>

          {error && <p className="note note--err mt-4">{error}</p>}

          <div className="btn-row mt-5">
            <button
              type="submit"
              disabled={sending || message.trim().length < 10}
              className="btn-ink"
            >
              {sending ? "Sending..." : "Send report"}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => onNavigate(HISTORY_ROUTE)}
            >
              My reports
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
