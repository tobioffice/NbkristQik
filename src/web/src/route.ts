/**
 * The app's address grammar.
 *
 * Sections live in the hash (`#/rank`): the address bar is the source of
 * truth, so Back, Forward and a reload land where the reader left off.
 *
 * Telegram uses the fragment for its own launch data, though. A Mini App is
 * handed `#tgWebAppData=…` (or `#/rank?tgWebAppData=…` when the client keeps
 * the button's path), so a fragment the bot wrote is either buried behind a
 * `?` or gone entirely. Bot buttons therefore name their section in
 * `?page=rank`, which the client leaves alone; `takePageLink` folds that into
 * the hash once at startup. The hash parser also stops at `?`, so links that
 * were already sent still open the right section.
 */

export type Section =
  | "profile"
  | "rank"
  | "games"
  | "play"
  | "verify"
  | "papers"
  | "issues"
  | "library";

export interface Route {
  section: Section;
  /** The opened conversation, for #/issues/<id>. */
  issue: string | null;
  /** True for #/issues: the reporter's own list. */
  mine: boolean;
}

/** The first screen: the roll form, the one thing the bot cannot do faster. */
export const HOME_ROUTE: Route = {
  section: "profile",
  issue: null,
  mine: false,
};

/**
 * The hidden `papers`, `games`, `play` and `verify` pages are routable by
 * direct link but are not in the shell's tab rail: an intake form, the league
 * board opened from the channel, today's run opened from the home banner, and
 * the roll-verification screen its Verify button opens.
 */
const SECTIONS: Section[] = [
  "profile",
  "rank",
  "games",
  "play",
  "verify",
  "papers",
  "issues",
  "library",
];

const isSection = (value: string): value is Section =>
  (SECTIONS as string[]).includes(value);

/**
 * A section path — `rank`, `/issues`, `issues/new`, `issues/QIK-0007` — as a
 * route. Anything unrecognised is the first screen, never a blank sheet.
 */
export const parseRoutePath = (path: string): Route => {
  const parts = path.split("/").filter(Boolean);
  const head = parts[0];
  if (!head || !isSection(head)) return HOME_ROUTE;
  if (head !== "issues") return { section: head, issue: null, mine: false };

  const second = parts[1];
  // The section's home is the reports list; a new report has its own address.
  // `reports` is the old list address, kept so bot messages already sent keep
  // working.
  if (!second || second === "reports")
    return { section: "issues", issue: null, mine: true };
  if (second === "new") return { section: "issues", issue: null, mine: false };
  return { section: "issues", issue: decodeIssue(second), mine: false };
};

/** A Telegram-supplied issue id can be escaped; a broken one is kept as typed. */
const decodeIssue = (raw: string): string => {
  try {
    return decodeURIComponent(raw).toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
};

/**
 * The router's one input: `window.location.hash`, with or without the `#`.
 * Telegram appends its launch parameters after a `?` when it keeps the path,
 * so the route ends there.
 */
export const parseRouteHash = (hash: string): Route =>
  parseRoutePath(hash.replace(/^#/, "").split("?")[0]);

/** The address that names a route. */
export const hashFor = (route: Route): string => {
  if (route.section === "profile") return "#/";
  if (route.section !== "issues") return `#/${route.section}`;
  if (route.issue) return `#/issues/${encodeURIComponent(route.issue)}`;
  return route.mine ? "#/issues" : "#/issues/new";
};

export interface PageLink {
  route: Route;
  /** The same address with the section folded into the hash. */
  href: string;
}

/**
 * A bot deep link's section, spent once.
 *
 * `…/library/?page=library&pc=<token>` becomes `…/library/?pc=<token>#/library`:
 * the page marker leaves, because a stale one would overrule every later tab
 * tap, and every other query parameter (the computer-link token, Telegram's
 * own) stays. Returns null when the address carries no deep link at all.
 */
export const takePageLink = (href: string): PageLink | null => {
  const url = new URL(href);
  const page = url.searchParams.get("page");
  if (!page) return null;

  const route = parseRoutePath(page);
  url.searchParams.delete("page");
  const query = url.searchParams.toString();
  return {
    route,
    href: `${url.pathname}${query ? `?${query}` : ""}${hashFor(route)}`,
  };
};

/**
 * The section a `startapp` direct link names, spent once.
 *
 * `https://t.me/<bot>?startapp=rank` opens the Main Mini App in the current
 * chat and hands it `start_param=rank`. The value is a route with underscores
 * in place of slashes (`issues_new`), because Telegram links only accept
 * letters, digits, underscores and hyphens. The parameter is removed from the
 * address bar like `?page=`, so a later tab tap is not overruled by it.
 */
export const takeStartParam = (
  href: string,
  startParam?: string | null,
): PageLink | null => {
  const url = new URL(href);
  const param =
    startParam?.trim() || url.searchParams.get("tgWebAppStartParam");
  if (!param) return null;

  const route = parseRoutePath(param.replace(/_/g, "/"));
  url.searchParams.delete("tgWebAppStartParam");
  const query = url.searchParams.toString();
  return {
    route,
    href: `${url.pathname}${query ? `?${query}` : ""}${hashFor(route)}`,
  };
};
