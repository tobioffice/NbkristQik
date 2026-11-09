import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Band from "./components/Band";
import BandStampProvider from "./BandStampProvider";
import type { BandStamp } from "./bandStamp";
import { useBackHandler } from "./backButton";
import { useAppConfig } from "./useAppConfig";
import { useTelegramIdentity } from "./useTelegramIdentity";
import { haptic } from "./telegram";
import type { IssuesRoute } from "./issuesRoute";
import {
  HOME_ROUTE,
  hashFor,
  parseRouteHash,
  takePageLink,
  type Route,
  type Section,
} from "./route";
import ProfileView from "./views/Profile";

// The reader and the issue desk are their own chunks; the first screen (the
// roll form) stays in the entry. Each route chunk is fetched the first time
// its tab opens, not before.
const LibraryView = lazy(() => import("./views/LibraryView"));
const Issues = lazy(() => import("./views/Issues"));

/**
 * The app: every surface the bot has, on one sheet.
 *
 * The first screen is the roll form. Attendance and the register live only in
 * the bot: the answer arrives with the bot's ad, and this sheet never becomes
 * a second place to read it. The cloth band says where you are and the tabs at
 * the foot turn to another section without leaving the sheet.
 *
 * Routes live in the hash, so a reload lands on the same page. Bot buttons
 * name their section in `?page=`, because Telegram replaces the fragment with
 * its own launch data; the shell folds it into the hash at startup:
 *   #/                    the roll form (the first screen)
 *   #/profile             the same form, by name
 *   #/library             the shelf
 *   #/issues              report an issue
 *   #/issues/reports      the reporter's own list
 *   #/issues/QIK-0007     one conversation
 */

interface SectionEntry {
  section: Section;
  tab: string;
  /** A 24×24 single-stroke path, drawn in the tab rail. */
  icon: string;
}

// The tab order is the order a student needs the app: their roll first (the
// bot's commands depend on it), then the way to report a problem. The shelf is
// last and appears only when the server opens it.
const SECTIONS: SectionEntry[] = [
  {
    section: "profile",
    tab: "Profile",
    icon: "M12 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM4.5 21c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4",
  },
  {
    section: "issues",
    tab: "Issues",
    icon: "M4 5.5h16v10H12l-4 3.5v-3.5H4z",
  },
  {
    section: "library",
    tab: "Library",
    icon: "M4 4.5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 4.5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z",
  },
];

/**
 * The one-time computer-link token, read once at startup. The hook that spends
 * it removes `pc` from the address bar, but the shell keeps it for this app
 * session so the shelf stays allowed until the cookie is in place.
 */
const readPcToken = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("pc") || undefined;
};

/**
 * The address bar at startup: a bot's `?page=` deep link first, then the
 * hash. Folding the page into the hash here (rather than reading it on every
 * render) keeps the hash the only route the shell ever consults, so the next
 * tab tap is not overruled by a stale deep link.
 */
const routeAtStartup = (): Route => {
  if (typeof window === "undefined") return HOME_ROUTE;
  const link = takePageLink(window.location.href);
  if (!link) return parseRouteHash(window.location.hash);
  try {
    window.history.replaceState(null, "", link.href);
  } catch {
    // an address bar we cannot rewrite still lands on the right section
  }
  return link.route;
};

/** The band's context line, by section. */
const BAND_SUB: Record<Section, string> = {
  profile: "Student profile",
  library: "Library",
  issues: "Issue reports",
};

export default function AppShell() {
  const [route, setRoute] = useState<Route>(routeAtStartup);
  const [stamp, setStamp] = useState<BandStamp | null>(null);
  const [immersive, setImmersive] = useState(false);
  const { tgUser, initData } = useTelegramIdentity();
  const appConfig = useAppConfig(tgUser ?? undefined, initData);
  const [pcToken, setPcToken] = useState(readPcToken);
  const [pcOpened, setPcOpened] = useState(false);
  const libraryOpen = appConfig.libraryOpen;

  // A successful exchange spends the token but keeps the shelf allowed for
  // this app session; the cookie is the permission from then on.
  const onPcConsumed = useCallback(() => {
    setPcToken(undefined);
    setPcOpened(true);
  }, []);

  // A valid session cookie opens the shelf through /api/config. A computer
  // link opens it before that first request: the cookie does not exist yet,
  // so the token itself is the permission.
  const libraryAllowed = libraryOpen || Boolean(pcToken) || pcOpened;

  // The shelf is admin-first for now. Its tab exists only when this caller may
  // open it; while the config is loading the safe default is "no", so the
  // shell never offers a shut door.
  const visibleSections = useMemo(
    () =>
      SECTIONS.filter((entry) => entry.section !== "library" || libraryAllowed),
    [libraryAllowed],
  );

  const go = useCallback((next: Route) => {
    haptic.select();
    const hash = hashFor(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(next);
    setImmersive(false);
  }, []);

  // the address bar is the source of truth: Back, Forward and the bot's deep
  // links all arrive as a hash change
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRouteHash(window.location.hash));
      // a deep link can land mid-reader; the sheet always comes back
      setImmersive(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // a new page starts at its top, the way turning a page does
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.section, route.issue, route.mine]);

  // a deep link into a closed shelf (or a tab left open from before the
  // library shut) puts the reader back on the first screen. replaceState keeps
  // the shuttered page out of the back trail.
  useEffect(() => {
    if (appConfig.loading || route.section !== "library" || libraryAllowed) {
      return;
    }
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#/`,
    );
    setRoute(HOME_ROUTE);
    setImmersive(false);
  }, [appConfig.loading, libraryAllowed, route.section]);

  // the Telegram arrow walks back out of a section; inside a conversation it
  // goes to the list first, the same trail the buttons walk
  const goHome = useCallback(() => go(HOME_ROUTE), [go]);
  const goBack = useCallback(() => {
    if (route.section === "issues" && route.issue) {
      go({ section: "issues", issue: null, mine: true });
      return;
    }
    goHome();
  }, [go, goHome, route.section, route.issue]);
  useBackHandler(route.section === "profile" || immersive ? null : goBack);

  const onIssuesRoute = useCallback(
    (next: IssuesRoute) =>
      go({
        section: "issues",
        issue: next.view === "thread" ? next.issue : null,
        mine: next.view === "history",
      }),
    [go],
  );

  return (
    <div className="app">
      <div className="sheet">
        {!immersive && (
          <Band
            sub={BAND_SUB[route.section]}
            stamp={stamp}
            onHome={route.section === "profile" ? undefined : goHome}
          />
        )}

        <BandStampProvider onChange={setStamp}>
          <main className="shell-body">
            <Suspense fallback={<PageLoading />}>
              {route.section === "library" && libraryAllowed && (
                <LibraryView
                  initData={initData}
                  pcToken={pcToken}
                  onPcConsumed={onPcConsumed}
                  onImmersiveChange={setImmersive}
                />
              )}
              {route.section === "profile" && (
                <ProfileSection
                  onReportIssue={() =>
                    go({ section: "issues", issue: null, mine: false })
                  }
                />
              )}
              {route.section === "issues" && (
                <IssuesSection
                  route={{
                    view: route.issue
                      ? "thread"
                      : route.mine
                        ? "history"
                        : "form",
                    issue: route.issue,
                  }}
                  onRoute={onIssuesRoute}
                />
              )}
            </Suspense>
          </main>
        </BandStampProvider>

        {!immersive && (
          <nav className="tabbar" aria-label="Sections">
            {visibleSections.map((entry) => (
              <Tab
                key={entry.section}
                label={entry.tab}
                icon={entry.icon}
                active={route.section === entry.section}
                onClick={() =>
                  go({ section: entry.section, issue: null, mine: false })
                }
              />
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

/** One index tab: a drawn icon over a tracked label. */
const Tab = ({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    className="tabbar__item"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={icon} />
    </svg>
    {label}
  </button>
);

/**
 * A route chunk is on its way. The cloth band and the tab rail stay exactly
 * where they are; only the page shape is drawn, so the tab switch does not
 * move the sheet.
 */
const PageLoading = () => (
  <div className="page" role="status" aria-busy="true" aria-label="Loading">
    <div className="page-body" aria-hidden="true">
      <div className="sk" style={{ height: 44, marginTop: 22 }} />
      <div className="sk" style={{ height: 44, marginTop: 12 }} />
      <div className="sk" style={{ height: 48, marginTop: 16 }} />
    </div>
  </div>
);

const ProfileSection = ({ onReportIssue }: { onReportIssue: () => void }) => {
  const { tgUser, initData } = useTelegramIdentity();
  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Profile</p>
        <h2 className="page-title">Your roll</h2>
        <p className="page-note">
          Optional. Save it once and /attendance, /midmarks and /bunk answer in
          one tap.
        </p>
      </div>
      <div className="page-body">
        <ProfileView
          tgUser={tgUser}
          initData={initData}
          compact
          onReportIssue={onReportIssue}
        />
      </div>
    </div>
  );
};

const IssuesSection = ({
  route,
  onRoute,
}: {
  route: IssuesRoute;
  onRoute: (route: IssuesRoute) => void;
}) => {
  const { tgUser, initData } = useTelegramIdentity();
  const identity = useMemo(
    () => ({ userId: tgUser ?? undefined, initData }),
    [tgUser, initData],
  );

  if (!tgUser) {
    return (
      <div className="page">
        <div className="page-head">
          <p className="eyebrow">Issues</p>
          <h2 className="page-title">Open this inside Telegram</h2>
          <p className="page-note">
            Reports are tied to your Telegram account. Open the bot and send
            /report to start one.
          </p>
        </div>
      </div>
    );
  }

  const eyebrow =
    route.view === "thread" ? (route.issue ?? "Issues") : "Issues";
  const title =
    route.view === "history"
      ? "My reports"
      : route.view === "thread"
        ? "Conversation"
        : "Report an issue";

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">{eyebrow}</p>
        <div className="head-row">
          <h2 className="page-title">{title}</h2>
          {route.view === "history" ? (
            <button
              className="btn-outline btn-sm"
              onClick={() => onRoute({ view: "form", issue: null })}
            >
              New report
            </button>
          ) : null}
        </div>
        {route.view === "form" ? (
          <p className="page-note">
            Describe what went wrong. You'll get an issue id to track it, and
            the reply lands here and in your chat.
          </p>
        ) : null}
      </div>
      <div className="page-body">
        <Issues
          identity={identity}
          route={route}
          onNavigate={onRoute}
          showTitle={false}
        />
      </div>
    </div>
  );
};
