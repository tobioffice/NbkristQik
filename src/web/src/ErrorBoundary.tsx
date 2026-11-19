import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The app's last resort, wrapped around the routed sections.
 *
 * Two failures land here, and both used to leave a permanently blank sheet:
 *   - a lazy route chunk that no longer exists. Telegram keeps a webview
 *     open for hours, and a deploy deletes the old hashed assets the moment
 *     the new build lands; the first tap on Ranks, Issues or Library then
 *     rejects the `import()` and unmounts the whole tree;
 *   - any render-time bug in a section.
 *
 * The shell (band and tab rail) is outside the boundary, so the student can
 * still walk to another tab. The one action that always fixes a stale
 * chunk is loading the current build.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    // no client logger exists; the console line is what a reported bug is
    // traced from
    console.error("[app] a section failed to render", info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="page" role="alert">
          <div className="page-head">
            <p className="eyebrow">App</p>
            <h2 className="page-title">This page didn&apos;t open</h2>
            <p className="page-note">
              The app was updated since you opened it, or something went
              wrong drawing the page. Reload to pick up the new version.
            </p>
          </div>
          <div className="page-body">
            <button className="btn-ink" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
