import { useEffect, useState } from "react";
import {
  fetchLibrarySubjects,
  openLibrarySession,
  type LibraryStudent,
  type LibrarySubject,
} from "./libraryApi";

/** What the shelf view can ask the server for. */
export type LibraryView = "all" | "roll";

export type LibraryStatus =
  | { state: "loading" }
  | { state: "unregistered" }
  /** The shelf is still the admin's: the API refuses every other account. */
  | { state: "closed" }
  | {
      state: "ready";
      student: LibraryStudent;
      subjects: LibrarySubject[];
      /** True for the admin: the view can be switched */
      admin: boolean;
      /** True when the list is the whole shelf, not the roll's semester */
      preview: boolean;
    }
  | { state: "error"; message: string };

/**
 * Library data layer.
 *
 * One request pair: open the session, then read the shelf. `retry` re-runs
 * both — the retry button, the roll-number form and the admin's view switch
 * all start from the session, because a session can have gone stale between
 * two looks at the shelf.
 */
export const useLibrary = (
  initData: string,
): {
  status: LibraryStatus;
  retry: () => void;
  setView: (view: LibraryView) => void;
} => {
  const [status, setStatus] = useState<LibraryStatus>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<LibraryView>("all");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const session = await openLibrarySession(initData);
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
        admin: shelf.admin === true,
        preview: shelf.preview === true,
      });
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
  }, [initData, attempt, view]);

  return {
    status,
    retry: () => setAttempt((count) => count + 1),
    setView,
  };
};
