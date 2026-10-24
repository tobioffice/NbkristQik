import { useEffect, useState } from "react";
import {
  fetchLibrarySubjects,
  openLibrarySession,
  type LibraryStudent,
  type LibrarySubject,
} from "./libraryApi";

export type LibraryStatus =
  | { state: "loading" }
  | { state: "unregistered" }
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
 * `attempt` re-runs the load: the retry button and the roll-number form both
 * bump it, so the fetch always starts from the effect.
 */
export type LibraryView = "all" | "roll";

export const useLibrary = (
  initData: string | undefined,
): {
  status: LibraryStatus;
  retry: () => void;
  view: LibraryView;
  setView: (view: LibraryView) => void;
} => {
  const [status, setStatus] = useState<LibraryStatus>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<LibraryView>("all");

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;

    openLibrarySession(initData)
      .then((session) => {
        if (cancelled) return null;
        if (!session.registered || !session.student) {
          setStatus({ state: "unregistered" });
          return null;
        }
        return fetchLibrarySubjects(view).then((list) => {
          if (cancelled) return;
          setStatus({
            state: "ready",
            student: session.student as LibraryStudent,
            subjects: list.subjects ?? [],
            admin: list.admin === true,
            preview: list.preview === true,
          });
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus({
          state: "error",
          message:
            e instanceof Error ? e.message : "Could not open the library",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [initData, attempt, view]);

  return {
    status,
    retry: () => setAttempt((n) => n + 1),
    view,
    setView,
  };
};
