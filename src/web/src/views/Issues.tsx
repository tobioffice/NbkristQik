import { useEffect, useMemo, useRef, useState } from "react";
import { submitReport, fetchMyReports, type MyReport } from "../api";
import { clearDraft, readDraft, reportDraftKey, writeDraft } from "../drafts";
import { dbUtcMs, istStampFromDb } from "../format";
import { reportStatusLabel } from "../reportStatus";
import { useClosingConfirmation } from "../telegram";
import { FORM_ROUTE, HISTORY_ROUTE, type IssuesRoute } from "../issuesRoute";
import ReportThreadView from "./ReportThread";
import ReportScreenshots from "../components/ReportScreenshots";

/**
 * The issue desk: file a report, then keep the conversation going.
 *
 * Every report is a thread — the admin answers from the panel, the reply
 * arrives here and in Telegram, and either side can add to it.
 *
 * This view is pure: the route in and the route out come from the caller, so
 * the app's Issues tab owns navigation and these screens only render the
 * screen that is open.
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
  const draftKey = reportDraftKey(identity.userId, "form");
  const [message, setMessage] = useState(() => readDraft(draftKey));
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingError, setLoadingError] = useState(false);
  const reportsInFlight = useRef(false);

  // a half-written report is worth more than a fast exit
  useClosingConfirmation(
    (message.trim().length > 0 || screenshots.length > 0) && !ticket,
  );

  // keep the draft across tab switches, back navigation and a reload
  useEffect(() => {
    writeDraft(draftKey, message);
  }, [draftKey, message]);

  // Leaving the form ends the receipt's life: a later "New report" must open
  // an empty form, not the ticket from the report sent earlier in this visit.
  const previousView = useRef(route.view);
  useEffect(() => {
    if (previousView.current === "form" && route.view !== "form") {
      setTicket(null);
    }
    previousView.current = route.view;
  }, [route.view]);

  // Replies on an older report matter more than a newer quiet one, so the
  // list follows the last thing said in each thread, not the id.
  const orderedReports = useMemo(() => {
    if (!reports) return null;
    const at = (report: MyReport) => {
      const ms = dbUtcMs(report.lastMessageAt);
      return Number.isNaN(ms) ? 0 : ms;
    };
    return [...reports].sort((a, b) => at(b) - at(a));
  }, [reports]);

  const charactersToSend = Math.max(0, 10 - message.trim().length);

  const loadReports = () => {
    if (!identity.userId || reportsInFlight.current) return;
    reportsInFlight.current = true;
    setLoadingReports(true);
    setLoadingError(false);
    fetchMyReports(identity)
      .then((rows) => {
        setReports(rows);
        onOpenCount?.(rows.filter((row) => row.status !== "resolved").length);
      })
      .catch(() => setLoadingError(true))
      .finally(() => {
        reportsInFlight.current = false;
        setLoadingReports(false);
      });
  };

  // every visit to the list refetches: a reply may have arrived in chat since
  // the last look, and a stale "unread" badge is worse than a short spinner
  useEffect(() => {
    if (route.view !== "history") return;
    loadReports();
    // deliberate: only on view switches, never on state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view]);

  // A Telegram notification can bring the Mini App back to the foreground
  // with the list still open. Re-read then, so the reply that brought them
  // back is on screen and the unread stamp is gone. The in-flight guard keeps
  // focus and visibility from spending two requests for the same return.
  useEffect(() => {
    if (route.view !== "history") return;
    const refresh = () => {
      if (document.visibilityState === "visible") loadReports();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
    // deliberate: the loader is recreated each render; this effect is about
    // the screen becoming visible, not about a state change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view]);

  const send = async () => {
    setError(null);
    const clean = message.trim();
    if (clean.length < 10 || clean.length > 1000) {
      setError("A report needs between 10 and 1000 characters.");
      return;
    }
    setSending(true);
    try {
      const { issueId } = await submitReport(identity, clean, screenshots);
      setTicket(issueId);
      setMessage("");
      setScreenshots([]);
      clearDraft(draftKey);
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
        key={route.issue}
        identity={identity}
        issueId={route.issue}
        seed={reports?.find((row) => row.issueId === route.issue) ?? null}
        onBack={() => onNavigate(HISTORY_ROUTE)}
        onNewReport={() => {
          setTicket(null);
          onNavigate(FORM_ROUTE);
        }}
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
              onClick={() => {
                setTicket(null);
                onNavigate(FORM_ROUTE);
              }}
              className="btn-ink btn-sm"
            >
              New report
            </button>
          </div>
        ) : null}

        {loadingReports && !orderedReports && (
          <div role="status" aria-busy="true" aria-label="Loading your reports">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="sk"
                style={{ height: 72, marginTop: 12 }}
              />
            ))}
          </div>
        )}

        {loadingError && (!orderedReports || orderedReports.length === 0) && (
          <div className="report-empty" role="alert">
            <p className="report-empty__title">Your reports didn't load.</p>
            <p className="form-note">
              Check your connection and try once more.
            </p>
            <button onClick={loadReports} className="btn-outline btn-sm mt-4">
              Retry
            </button>
          </div>
        )}

        {orderedReports && orderedReports.length === 0 && !loadingError && (
          <div className="report-empty">
            <p className="report-empty__title">No reports yet</p>
            <p className="form-note">
              The admin's reply lands here and in your chat.
            </p>
            <button
              onClick={() => {
                setTicket(null);
                onNavigate(FORM_ROUTE);
              }}
              className="btn-ink mt-4"
            >
              Report an issue
            </button>
          </div>
        )}

        {orderedReports && orderedReports.length > 0 && (
          <ul className="report-list">
            {orderedReports.map((report) => {
              const activity = istStampFromDb(report.lastMessageAt);
              return (
                <li key={report.issueId} className="report-entry">
                  <button
                    onClick={() =>
                      onNavigate({ view: "thread", issue: report.issueId })
                    }
                    className="report-entry__open"
                    aria-label={`Open report ${report.issueId}`}
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
                          {reportStatusLabel(report.status)}
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
                      <span>
                        {report.lastAuthor === "admin"
                          ? "admin wrote last"
                          : "you wrote last"}
                      </span>
                      {activity ? (
                        <span className="report-entry__when">{activity}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
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
            <p className="ticket__note">Keep this id for follow-ups.</p>
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
        <>
          {showTitle ? (
            <div className="head-row">
              <h2 className="form-title">Report an issue</h2>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => onNavigate(HISTORY_ROUTE)}
              >
                My reports
              </button>
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            noValidate
          >
            <label className="field">
              <span>What happened?</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                maxLength={1000}
                placeholder="Marks are showing wrong for my roll. The portal says 22 but the bot shows 13."
              />
              <span className="char-count">
                {charactersToSend > 0
                  ? `${message.length}/1000, ${charactersToSend} more characters`
                  : `${message.length}/1000`}
              </span>
            </label>

            <ReportScreenshots
              files={screenshots}
              onChange={setScreenshots}
              disabled={sending}
            />

            {error && <p className="note note--err mt-4">{error}</p>}

            <div className="btn-row mt-5">
              <button
                type="submit"
                disabled={sending || message.trim().length < 10}
                className="btn-ink"
              >
                {sending ? "Sending..." : "Send report"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
