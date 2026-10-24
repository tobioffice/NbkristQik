/**
 * The issue desk's routes.
 *
 * The screens are pure — the caller decides which one is open — so the same
 * three screens serve the standalone report page (query-string routes) and the
 * app's Issues tab (hash routes).
 */
export type IssuesView = "form" | "history" | "thread";

export interface IssuesRoute {
  view: IssuesView;
  /** The open conversation, when the route names one. */
  issue: string | null;
}

export const FORM_ROUTE: IssuesRoute = { view: "form", issue: null };
export const HISTORY_ROUTE: IssuesRoute = { view: "history", issue: null };
