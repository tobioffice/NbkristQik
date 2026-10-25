import { useCallback, useEffect, useMemo, useState } from "react";
import Band from "./components/Band";
import BandStampProvider from "./BandStampProvider";
import type { BandStamp } from "./bandStamp";
import { useBackHandler } from "./backButton";
import { useTelegramIdentity } from "./useTelegramIdentity";
import { useTelegramUser } from "./useTelegramUser";
import { haptic } from "./telegram";
import Leaderboard from "./Leaderboard";
import LibraryView from "./views/LibraryView";
import Issues from "./views/Issues";
import type { IssuesRoute } from "./issuesRoute";
import ProfileView from "./views/Profile";

/**
 * The app: every surface the bot has, on one sheet.
 *
 * A register has an index page and tabs down its edge. This app is the same
 * object: the cloth band says where you are, the ruled index lists what the
 * register holds, and the tabs at the foot of the page turn to a section
 * without leaving the sheet.
 *
 * Routes live in the hash, so a reload or a bot deep link lands on the same
 * page:
 *   #/                    the index
 *   #/rank                the attendance register
 *   #/library             the shelf
 *   #/profile             the student's roll
 *   #/issues              report an issue
 *   #/issues/reports      the reporter's own list
 *   #/issues/QIK-0007     one conversation
 */

type Section = "index" | "rank" | "library" | "profile" | "issues";

interface Route {
  section: Section;
  /** The opened conversation, for #/issues/<id>. */
  issue: string | null;
  /** True for #/issues/reports: the reporter's own list. */
  mine: boolean;
}

interface SectionEntry {
  section: Exclude<Section, "index">;
  tab: string;
  number: string;
  title: string;
  note: string;
  /** A 24×24 single-stroke path, drawn in the tab rail. */
  icon: string;
}

const SECTIONS: SectionEntry[] = [
  {
    section: "rank",
    tab: "Ranks",
    number: "01",
    title: "The attendance register",
    note: "Every student, ranked by attendance or mid-marks.",
    icon: "M4 19V11M10 19V5M16 19V14M21 19H3",
  },
  {
    section: "library",
    tab: "Library",
    number: "02",
    title: "The shelf",
    note: "Your semester's units, open in front of you.",
    icon: "M4 4.5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 4.5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z",
  },
  {
    section: "profile",
    tab: "Profile",
    number: "03",
    title: "Your roll",
    note: "Saved once, and every command answers in one tap.",
    icon: "M12 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM4.5 21c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4",
  },
  {
    section: "issues",
    tab: "Issues",
    number: "04",
    title: "The issue desk",
    note: "Something wrong? Report it and follow the reply.",
    icon: "M4 5.5h16v10H12l-4 3.5v-3.5H4z",
  },
];

const INDEX_ROUTE: Route = { section: "index", issue: null, mine: false };

const parseRoute = (): Route => {
  const parts = (typeof window === "undefined" ? "" : window.location.hash)
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
  const section = parts[0] as Section;
  if (!SECTIONS.some((entry) => entry.section === section)) return INDEX_ROUTE;

  if (section !== "issues") return { section, issue: null, mine: false };
  if (!parts[1]) return { section, issue: null, mine: false };
  if (parts[1] === "reports") return { section, issue: null, mine: true };
  return {
    section,
    issue: decodeURIComponent(parts[1]).toUpperCase(),
    mine: false,
  };
};

const hashFor = (route: Route): string => {
  if (route.section === "index") return "#/";
  if (route.section !== "issues") return `#/${route.section}`;
  if (route.issue) return `#/issues/${encodeURIComponent(route.issue)}`;
  return route.mine ? "#/issues/reports" : "#/issues";
};

/** The band's context line, by section. */
const BAND_SUB: Record<Section, string> = {
  index: "Student register",
  rank: "Attendance register",
  library: "Library",
  profile: "Student profile",
  issues: "Issue reports",
};

export default function AppShell() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [stamp, setStamp] = useState<BandStamp | null>(null);
  const [immersive, setImmersive] = useState(false);
  const { initData } = useTelegramIdentity();

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
      setRoute(parseRoute());
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

  // the Telegram arrow walks back out of a section; inside a conversation it
  // goes to the list first, the same trail the buttons walk
  const goHome = useCallback(() => go(INDEX_ROUTE), [go]);
  const goBack = useCallback(() => {
    if (route.section === "issues" && route.issue) {
      go({ section: "issues", issue: null, mine: true });
      return;
    }
    goHome();
  }, [go, goHome, route.section, route.issue]);
  useBackHandler(route.section === "index" || immersive ? null : goBack);

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
            onHome={route.section === "index" ? undefined : goHome}
          />
        )}

        <BandStampProvider onChange={setStamp}>
          <main className="shell-body">
            {route.section === "index" && (
              <IndexPage
                onOpen={(section) => go({ section, issue: null, mine: false })}
              />
            )}
            {route.section === "rank" && <Leaderboard showBand={false} />}
            {route.section === "library" &&
              (initData ? (
                <LibraryView
                  initData={initData}
                  onImmersiveChange={setImmersive}
                />
              ) : (
                <OutsideTelegram />
              ))}
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
          </main>
        </BandStampProvider>

        {!immersive && (
          <nav className="tabbar" aria-label="Sections">
            <Tab
              label="Index"
              icon="M4 6h16M4 12h16M4 18h11"
              active={route.section === "index"}
              onClick={goHome}
            />
            {SECTIONS.map((entry) => (
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
 * The index page.
 *
 * The front matter of the register: who is reading, and what the register
 * holds. Each row is a ruled entry with its section number in the margin, the
 * way an index is printed — no cards, no boxes.
 */
const IndexPage = ({
  onOpen,
}: {
  onOpen: (section: Exclude<Section, "index">) => void;
}) => {
  const { myRoll, myRank } = useTelegramUser();
  const rank = myRank?.attendance?.rank ?? myRank?.midmarks?.rank ?? null;

  return (
    <div className="cover">
      <p className="eyebrow">NbkristQik · open on the desk</p>
      <h1 className="cover__title">Your register</h1>
      <p className="cover__note">
        Attendance, mid-marks, the books for your semester, and a way to say
        when something is wrong. All of it on one sheet.
      </p>

      <div className="cover__viewer">
        <span className="cover__viewer-label">
          {myRoll ? "Reading as" : "Not signed in"}
        </span>
        <span className="cover__viewer-roll">{myRoll ?? "Save your roll"}</span>
        {myRoll && rank != null ? (
          <span className="cover__viewer-rank">
            #{rank}
            <small>attendance</small>
          </span>
        ) : null}
      </div>

      <div className="index-list">
        {SECTIONS.map((entry) => (
          <button
            key={entry.section}
            className="index-row"
            onClick={() => onOpen(entry.section)}
          >
            <span className="index-row__no">{entry.number}</span>
            <span className="index-row__name">
              {entry.title}
              <small>{entry.note}</small>
            </span>
            <svg
              aria-hidden="true"
              className="index-row__go"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>

      <p className="cover__foot">
        Tap the wordmark to come back here. The bot still answers in chat: send
        a roll number, or use /help.
      </p>
    </div>
  );
};

const OutsideTelegram = () => (
  <div className="page">
    <div className="page-head">
      <p className="eyebrow">Library</p>
      <h2 className="page-title">Open it from Telegram</h2>
      <p className="page-note">
        The library is only for NbkristQik bot users. Open the bot and tap
        Library, and it will open here.
      </p>
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
