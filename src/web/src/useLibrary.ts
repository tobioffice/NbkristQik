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
 * `retry` starts again from the session — the retry button, the roll-number
 * form and the admin's view switch all do, because a session can have gone
 * stale between two looks at the shelf.
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

  useEffect(() => {
    let cancelled = false;

    const readShelf = async (session: SessionResponse) => {
      if (cancelled) return;

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
        const session = await openLibrarySession({ initData, pcToken });
        if (cancelled) return;
        if (credential === "pcToken") {
          // The server consumed the link. Tell the shell not to present it
          // again on the next mount; the cookie is the session now.
          onPcConsumed?.();
        }
        await readShelf(session);
        return;
      }

      // No credential was presented: a live cookie is the cheapest session.
      const existing = await fetchLibraryMe();
      if (cancelled) return;

      if (existing) {
        await readShelf(existing);
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
  }, [initData, pcToken, onPcConsumed, attempt, view]);

  const signOut = async (): Promise<void> => {
    await closeLibrarySession();
    setStatus({ state: "no-session" });
  };

  return {
    status,
    retry: () => setAttempt((count) => count + 1),
    setView,
    signOut,
  };
};
