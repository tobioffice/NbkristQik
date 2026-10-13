import { useEffect, useRef, useState } from "react";
import { useTelegramIdentity } from "./useTelegramIdentity";
import { submitReport, fetchMyReports, type MyReport } from "./api";
import Band from "./components/Band";
import ReportThreadView from "./views/ReportThread";

type View = "form" | "history" | "thread";

interface TgWebApp {
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (cb: () => void) => void;
    offClick?: (cb: () => void) => void;
  };
}

const telegramWebApp = (): TgWebApp | null => {
  try {
    return (
      (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram
        ?.WebApp ?? null
    );
  } catch {
    return null;
  }
};

/**
 * The page has two deep links, both used by the bot's buttons:
 *   ?issue=QIK-0007 — one conversation ("Open the thread")
 *   ?view=reports  — the reporter's own issue list ("My reports")
 * Anything else opens the form.
 */
const routeFromUrl = (): { view: View; issue: string | null } => {
  try {
    const params = new URLSearchParams(window.location.search);
    const issue = params.get("issue");
    if (issue) return { view: "thread", issue: issue.toUpperCase() };
    if (params.get("view") === "reports") {
      return { view: "history", issue: null };
    }
  } catch {
    /* no window: fall through to the form */
  }
  return { view: "form", issue: null };
};

const LockIcon = () => (
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="30"
    height="30"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="10.5" width="14" height="9.5" rx="1" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14.5v2" />
  </svg>
);

/**
 * Issue reports mini app: file an issue, then keep the conversation going.
 * Every report is a thread — the admin answers from the panel, the reply
 * arrives here and in Telegram, and either side can add to it.
 */
function ReportApp() {
  const { tgUser, initData } = useTelegramIdentity();
  const [route, setRoute] = useState(routeFromUrl);
  const { view, issue: openIssue } = route;
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingError, setLoadingError] = useState(false);
  // true once this session pushed a history entry, so Back can pop it
  const pushed = useRef(false);

  const identity = { userId: tgUser ?? undefined, initData };

  const loadReports = () => {
    if (!tgUser) return;
    setLoadingReports(true);
    setLoadingError(false);
    fetchMyReports(identity)
      .then((rows) => setReports(rows))
      .catch(() => setLoadingError(true))
      .finally(() => setLoadingReports(false));
  };

  // history loads the first time the view opens; later visits refetch via the buttons
  useEffect(() => {
    if (view === "history" && reports === null && !loadingReports) loadReports();
    // deliberate: only fire on view switches, avoid refetch loops on state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // the list and each thread are real pages: the query string survives a
  // reload, and Back (Telegram's button or the browser's) walks the trail
  const navigate = (next: { view: View; issue?: string | null }) => {
    const query =
      next.view === "thread" && next.issue
        ? `?issue=${encodeURIComponent(next.issue)}`
        : next.view === "history"
          ? "?view=reports"
          : "";
    pushed.current = true;
    window.history.pushState({}, "", `${window.location.pathname}${query}`);
    setRoute(routeFromUrl());
  };

  const back = () => {
    if (pushed.current) {
      window.history.back();
      return;
    }
    // deep-linked straight into a view: leave the list behind, not the form
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?view=reports`,
    );
    setRoute(routeFromUrl());
  };

  useEffect(() => {
    const onPop = () => {
      const next = routeFromUrl();
      setRoute(next);
      // coming back from a thread: refetch so the "new" stamps are current
      if (next.view === "history") setReports(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // inside the Telegram webview there is no browser chrome, so the native
  // back button has to be wired to the same thing whenever we are not on the
  // form (a thread, or the list opened from the bot's second button)
  useEffect(() => {
    const tg = telegramWebApp();
    if (!tg?.BackButton) return;
    const onBack = () => back();
    if (view !== "form") {
      tg.BackButton.onClick?.(onBack);
      tg.BackButton.show?.();
      return () => {
        tg.BackButton?.offClick?.(onBack);
        tg.BackButton?.hide?.();
      };
    }
    tg.BackButton.hide?.();
  }, [view]);

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
      setReports(null); // history refetches next visit
    } catch (e) {
      setError((e as Error).message || "Could not send the report.");
    } finally {
      setSending(false);
    }
  };

  if (!tgUser) {
    return (
      <div className="app">
        <div className="sheet">
          <Band sub="Issue reports" />
          <div className="form-wrap">
            <div className="form-block">
              <div className="state-block">
                <LockIcon />
                <p className="title">Open this inside Telegram</p>
                <p className="sub">
                  Reports are tied to your Telegram account. Open the bot and
                  send /report to start one.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="sheet">
        <Band sub={view === "thread" ? "Conversation" : "Issue reports"} />
        <div className="form-wrap">
          {view === "form" && !ticket && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="form-block"
              noValidate
            >
              <h1 className="form-title form-title--lg">Report an issue</h1>
              <p className="form-note">
                Describe what went wrong. You'll get an issue id to track it,
                and the reply lands in your Telegram chat.
              </p>

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

              <button
                type="submit"
                disabled={sending || message.trim().length < 10}
                className="btn-ink w-full mt-5"
              >
                {sending ? "Sending..." : "Send report"}
              </button>
            </form>
          )}

          {view === "form" && ticket && (
            <div className="form-block">
              <div className="ticket">
                <p className="ticket__label">Report received</p>
                <p className="ticket__id">{ticket}</p>
                <p className="ticket__note">
                  Keep this id for follow-ups. The reply lands in your Telegram
                  chat and on this thread.
                </p>
              </div>
              <div className="btn-row">
                <button
                  onClick={() => navigate({ view: "thread", issue: ticket })}
                  className="btn-ink"
                >
                  Open thread
                </button>
                <button
                  onClick={() => {
                    setTicket(null);
                  }}
                  className="btn-outline"
                >
                  Report another
                </button>
              </div>
              <p className="form-note mt-4">
                <button
                  onClick={() => {
                    setTicket(null);
                    navigate({ view: "history" });
                  }}
                  className="link-btn"
                >
                  All my reports
                </button>
              </p>
            </div>
          )}

          {view === "history" && (
            <div className="form-block">
              <div className="flex items-baseline justify-between gap-3">
                <h1 className="form-title">My reports</h1>
                <button
                  onClick={() => {
                    setReports(null);
                    navigate({ view: "form" });
                  }}
                  className="btn-outline btn-sm"
                >
                  New report
                </button>
              </div>

              {loadingReports && (
                <div aria-hidden="true">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="sk"
                      style={{ height: 72, marginTop: 12 }}
                    />
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
                  No reports yet. Anything you send shows up here with its
                  status.
                </p>
              )}

              {reports && reports.length > 0 && (
                <ul className="report-list">
                  {reports.map((r) => (
                    <li key={r.issueId} className="report-entry">
                      <button
                        onClick={() =>
                          navigate({ view: "thread", issue: r.issueId })
                        }
                        className="report-entry__open"
                        aria-label={`Open thread ${r.issueId}`}
                      >
                        <span className="report-entry__head">
                          <span className="issue-id">{r.issueId}</span>
                          <span className="report-entry__marks">
                            {r.unread > 0 && (
                              <span className="report-entry__new">
                                {r.unread} new
                              </span>
                            )}
                            <span
                              className={`status-mark status-mark--${r.status}`}
                            >
                              <i aria-hidden="true" />
                              {r.status}
                            </span>
                          </span>
                        </span>
                        <span className="report-entry__msg">{r.message}</span>
                        {r.adminReply && (
                          <span className="report-entry__reply">
                            <b>reply from the admin</b>
                            {r.adminReply}
                          </span>
                        )}
                        <span className="report-entry__foot">
                          {r.messageCount > 1
                            ? `${r.messageCount} messages`
                            : "1 message"}
                          {" · "}
                          {r.lastAuthor === "admin"
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
          )}

          {view === "thread" && openIssue && (
            <ReportThreadView
              identity={identity}
              issueId={openIssue}
              seed={reports?.find((r) => r.issueId === openIssue) ?? null}
              onBack={back}
              onNewReport={() => navigate({ view: "form" })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default ReportApp;
