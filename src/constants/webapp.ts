// Telegram mini app pages. The leaderboard and the registration/profile form
// are separate pages; both are direct https URLs as Telegram web_app
// buttons require.
export const WEBAPP_URL = "https://tobioffice.github.io/NbkristQik/index.html";
export const REGISTER_WEBAPP_URL =
  "https://tobioffice.github.io/NbkristQik/register.html";
export const REPORT_WEBAPP_URL =
  "https://tobioffice.github.io/NbkristQik/report.html";
/** The same mini app, opened straight on the reporter's own issue list. */
export const REPORT_LIST_WEBAPP_URL = `${REPORT_WEBAPP_URL}?view=reports`;

/**
 * The library is served by our own host, not from GitHub Pages: its session
 * cookie has to be first-party, or iOS drops it and the student is signed
 * out on every open.
 */
export const LIBRARY_WEBAPP_URL = "https://checker.tobioffice.dev/library/";
