import { useEffect, useRef, useState } from "react";
import { useTelegramIdentity } from "./useTelegramIdentity";
import { useBackHandler } from "./backButton";
import Band from "./components/Band";
import Issues from "./views/Issues";
import { HISTORY_ROUTE, type IssuesRoute } from "./issuesRoute";

/**
 * The standalone report page (report.html).
 *
 * The screens themselves live in `views/Issues.tsx`; this wrapper owns the
 * page-level plumbing: it reads the bot's deep links
 *   ?issue=QIK-0007 — one conversation ("Open the thread")
 *   ?view=reports  — the reporter's own issue list ("My reports")
 * and keeps the address bar in step, so a reload lands where the student was.
 */

const routeFromUrl = (): IssuesRoute => {
  try {
    const params = new URLSearchParams(window.location.search);
    const issue = params.get("issue");
    if (issue) return { view: "thread", issue: issue.toUpperCase() };
    if (params.get("view") === "reports") return HISTORY_ROUTE;
  } catch {
    /* no window: fall through to the form */
  }
  return { view: "form", issue: null };
};

const queryFor = (route: IssuesRoute): string =>
  route.view === "thread" && route.issue
    ? `?issue=${encodeURIComponent(route.issue)}`
    : route.view === "history"
      ? "?view=reports"
      : "";

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

function ReportApp() {
  const { tgUser, initData } = useTelegramIdentity();
  const [route, setRoute] = useState<IssuesRoute>(routeFromUrl);
  // true once this session pushed a history entry, so Back can pop it
  const pushed = useRef(false);

  const identity = { userId: tgUser ?? undefined, initData };

  const navigate = (next: IssuesRoute) => {
    pushed.current = true;
    window.history.pushState({}, "", `${window.location.pathname}${queryFor(next)}`);
    setRoute(next);
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
    setRoute(HISTORY_ROUTE);
  };

  useEffect(() => {
    const onPop = () => setRoute(routeFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // inside the Telegram webview the native arrow has to walk the same trail
  useBackHandler(route.view === "form" ? null : back);

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
        <Band sub={route.view === "thread" ? "Conversation" : "Issue reports"} />
        <div className="form-wrap">
          {route.view === "form" && (
            <div className="form-block">
              <h1 className="form-title form-title--lg">Report an issue</h1>
              <p className="form-note">
                Describe what went wrong. You'll get an issue id to track it,
                and the reply lands here and in your chat.
              </p>
            </div>
          )}
          <Issues
            identity={identity}
            route={route}
            onNavigate={navigate}
          />
        </div>
      </div>
    </div>
  );
}

export default ReportApp;
