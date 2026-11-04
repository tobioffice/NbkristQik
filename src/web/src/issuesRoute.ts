/**
 * The issue desk's routes.
 *
 * The screens are pure — the caller decides which one is open. The app's
 * Issues tab maps its hash routes onto these.
 */
export type IssuesView = "form" | "history" | "thread";

export interface IssuesRoute {
  view: IssuesView;
  /** The open conversation, when the route names one. */
  issue: string | null;
}

export const FORM_ROUTE: IssuesRoute = { view: "form", issue: null };
export const HISTORY_ROUTE: IssuesRoute = { view: "history", issue: null };
