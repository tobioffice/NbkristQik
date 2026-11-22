/**
 * Where the bot sends a student.
 *
 * One app holds the roll, the issue desk and the shelf, reached by a hash
 * route. Attendance and the register are answered only in the chat. It is served from
 * our own host rather than GitHub Pages, because the library's session cookie
 * has to be first-party or iOS drops it and the reader is signed out on every
 * open.
 *
 * A section rides in `?page=` rather than in the fragment. Telegram hands a
 * Mini App its launch data in the fragment (`#tgWebAppData=…`) and drops
 * whatever the button put there, while the query string arrives intact. The
 * app folds the page into its hash route on load (`takePageLink` in
 * `src/web/src/route.ts`); the hash routes must match it.
 *
 * A group has no `web_app` buttons, so there the same section becomes a
 * direct link: `https://t.me/<bot>?startapp=<section>`. Telegram opens the
 * Main Mini App in the current chat, and the app reads `start_param` on load.
 */

import { BOT_USERNAME } from "./bot.js";

const APP_BASE = "https://checker.tobioffice.online/library/";

/** The app's index page. */
export const APP_WEBAPP_URL = APP_BASE;

/** One section of the app, by its route path. */
const section = (route: string): string => {
  const page = route
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${APP_BASE}?page=${page}`;
};

/**
 * A section as a `startapp` value. Telegram allows letters, digits,
 * underscores and hyphens, so the route's slashes become underscores.
 */
export const startParamFor = (route: string): string =>
  route.split("/").filter(Boolean).join("_") || "profile";

/**
 * A direct link that opens the Main Mini App in the current chat. It works in
 * groups and channels, where Telegram rejects `web_app` buttons.
 */
export const appDirectLink = (route: string): string =>
  `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(
    startParamFor(route),
  )}`;

/** The sections the bot links to. */
export type AppPage =
  | "profile"
  | "rank"
  | "games"
  | "verify"
  | "library"
  | "issues"
  | "issues/new"
  | "papers";

/** The same section as a Mini App button target or a direct link. */
export const appPageUrl = (
  page: AppPage,
  mode: "web_app" | "direct",
): string => (mode === "web_app" ? section(page) : appDirectLink(page));

/** The profile form. */
export const REGISTER_WEBAPP_URL = section("/profile");

/** The attendance register, opened from a card's Leaderboard button. */
export const LEADERBOARD_WEBAPP_URL = section("/rank");

/** The library shelf (admin-only until LIBRARY_ACCESS=all). */
export const LIBRARY_WEBAPP_URL = section("/library");

/** The issue form, and the reporter's own list. */
export const REPORT_WEBAPP_URL = section("/issues/new");
export const REPORT_LIST_WEBAPP_URL = section("/issues");

/** The hidden question-paper intake; there is deliberately no tab for it. */
export const PAPER_INTAKE_WEBAPP_URL = section("/papers");

/** One conversation, for a reply notification. */
export const reportThreadUrl = (issueId: string): string =>
  section(`/issues/${issueId}`);
