import { useEffect, useState } from "react";
import {
  closeLibrarySession,
  fetchLibraryMe,
  fetchLibrarySubjects,
  openLibrarySession,
  type LibraryIdentity,
  type LibraryStudent,
  type LibrarySubject,
  type SessionResponse,
} from "./libraryApi";

/** What the shelf view can ask the server for. */
export type LibraryView = "all" | "roll";

export type LibraryStatus =
  | { state: "loading" }
  /** No cookie, and no Telegram identity or computer link to open one. */
  | { state: "no-session" }
  | { state: "unregistered" }
  /** The shelf is still the admin's: the API refuses every other account. */
  | { state: "closed" }
  | {
      state: "ready";
      student: LibraryStudent;
      subjects: LibrarySubject[];
      /** A PC session is shorter and offers a sign-out on a shared machine. */
      kind: "telegram" | "pc";
      /** True for the admin: the view can be switched */
      admin: boolean;
      /** True when the list is the whole shelf, not the roll's semester */
      preview: boolean;
    }
  | { state: "error"; message: string };

/** Which credential an exchange would carry, if there is one to carry. */
export type SessionCredential = "initData" | "pcToken";

/**
 * A computer link names the account it was minted for, so it wins when a
 * browser somehow has both; the server will not fall back from a bad link.
 * An empty string counts as absent, the way the SDK reports it.
 */
export const sessionCredential = (
  identity: LibraryIdentity,
): SessionCredential | null => {
  if (identity.pcToken) return "pcToken";
  if (identity.initData) return "initData";
  return null;
};

/**
 * The same address with the one-time `pc` token gone, other query parameters
 * and the route hash intact. The token must never sit in the address bar
 * after it has been spent.
 */
export const addressWithoutPcToken = (href: string): string => {
  const url = new URL(href);
  url.searchParams.delete("pc");
  return `${url.pathname}${url.search}${url.hash}`;
};

const clearPcToken = (): void => {
  try {
    window.history.replaceState(
      null,
      "",
      addressWithoutPcToken(window.location.href),
    );
  } catch {
    // an address bar we cannot rewrite is not a reason to fail the shelf
  }
};

/**
 * Library data layer.
 *
 * A presented credential is an account hand-off and always wins: a stale
 * library cookie on a shared browser must not keep another account's shelf.
 * With no credential, a live cookie is enough and `/me` is the only call.
 * The computer-link token leaves the address bar as soon as it is spent.
 *
 * The hand-off and the shelf read are two effects. `retry` starts again
 * from the session — the retry button and the roll-number form both do,
 * because a session can have gone stale between two looks at the shelf —
 * but the admin's view switch only re-reads the list: every hand-off costs
 * a POST /api/library/session against the exchange limit (20 an hour), so
 * a toggle must not spend that budget.
 */
export const useLibrary = (
  identity: LibraryIdentity,
  options: { onPcConsumed?: () => void } = {},
): {
  status: LibraryStatus;
  retry: () => void;
  setView: (view: LibraryView) => void;
  signOut: () => Promise<void>;
} => {
  const { initData, pcToken } = identity;
  const { onPcConsumed } = options;
  const [status, setStatus] = useState<LibraryStatus>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<LibraryView>("all");
  const [session, setSession] = useState<SessionResponse | null>(null);

  // The account hand-off: a presented credential, or the cookie's own /me.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // A credential that was just presented is the account hand-off: the
      // computer link names the account it was minted for, and Telegram's
      // initData names the current Telegram user. It must win over a stale
      // cookie left by another account on a shared browser.
      const credential = sessionCredential({ initData, pcToken });
      if (credential) {
        // The one-time token should not sit in the address bar even while
        // the exchange is in flight or if it fails.
        if (credential === "pcToken") clearPcToken();
        const opened = await openLibrarySession({ initData, pcToken });
        if (cancelled) return;
        if (credential === "pcToken") {
          // The server consumed the link. Tell the shell not to present it
          // again on the next mount; the cookie is the session now.
          onPcConsumed?.();
        }
        setSession(opened);
        return;
      }

      // No credential was presented: a live cookie is the cheapest session.
      const existing = await fetchLibraryMe();
      if (cancelled) return;

      if (existing) {
        setSession(existing);
        return;
      }

      setStatus({ state: "no-session" });
    };

    load().catch((e) => {
      if (cancelled) return;
      const message =
        e instanceof Error ? e.message : "Could not open the library";
      // a closed shelf is not a fault: it is simply not open yet
      if (/not open yet/i.test(message)) {
        setStatus({ state: "closed" });
        return;
      }
      setStatus({ state: "error", message });
    });

    return () => {
      cancelled = true;
    };
  }, [initData, pcToken, onPcConsumed, attempt]);

  // Reading the shelf for the resolved session and the chosen view. The
  // rows stay on screen while a switch re-reads; only the data lands late.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const readShelf = async () => {
      if (!session.registered || !session.student) {
        setStatus({ state: "unregistered" });
        return;
      }

      const shelf = await fetchLibrarySubjects(view);
      if (cancelled) return;

      setStatus({
        state: "ready",
        student: session.student,
        subjects: shelf.subjects ?? [],
        kind: session.kind ?? "telegram",
        admin: shelf.admin === true,
        preview: shelf.preview === true,
      });
    };

    readShelf().catch((e) => {
      if (cancelled) return;
      const message =
        e instanceof Error ? e.message : "Could not open the library";
      if (/not open yet/i.test(message)) {
        setStatus({ state: "closed" });
        return;
      }
      setStatus({ state: "error", message });
    });

    return () => {
      cancelled = true;
    };
  }, [session, view]);

  const signOut = async (): Promise<void> => {
    await closeLibrarySession();
    setSession(null);
    setStatus({ state: "no-session" });
  };

  return {
    status,
    retry: () => {
      // the full hand-off again: a session that went stale is replaced end
      // to end, not just its shelf read
      setSession(null);
      setAttempt((count) => count + 1);
    },
    setView,
    signOut,
  };
};
