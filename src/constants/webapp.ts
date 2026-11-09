/**
 * Where the bot sends a student.
 *
 * One app holds every surface now: the register, the shelf, the roll and the
 * issue desk are sections of it, reached by a hash route. It is served from
 * our own host rather than GitHub Pages, because the library's session cookie
 * has to be first-party or iOS drops it and the reader is signed out on every
 * open.
 *
 * A section rides in `?page=` rather than in the fragment. Telegram hands a
 * Mini App its launch data in the fragment (`#tgWebAppData=…`) and drops
 * whatever the button put there, while the query string arrives intact. The
 * app folds the page into its hash route on load (`takePageLink` in
 * `src/web/src/route.ts`); the hash routes must match it.
 */

const APP_BASE = "https://checker.tobioffice.dev/library/";

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

/** Leaderboard: the attendance register. */
export const WEBAPP_URL = section("/rank");

/** The profile form. */
export const REGISTER_WEBAPP_URL = section("/profile");

/** The library shelf (admin-only until LIBRARY_ACCESS=all). */
export const LIBRARY_WEBAPP_URL = section("/library");

/** The issue form, and the reporter's own list. */
export const REPORT_WEBAPP_URL = section("/issues");
export const REPORT_LIST_WEBAPP_URL = section("/issues/reports");

/** One conversation, for a reply notification. */
export const reportThreadUrl = (issueId: string): string =>
  section(`/issues/${issueId}`);
