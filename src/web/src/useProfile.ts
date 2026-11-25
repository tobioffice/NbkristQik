import { useCallback, useEffect, useState } from "react";
import {
  deleteLastLookup,
  getProfile,
  registerRoll,
  type GameRun,
  type ProfileResponse,
  type StudentInfo,
} from "./api";

interface Profile {
  found: boolean;
  registered: boolean;
  /** The saved registration's roll. A past lookup never fills this. */
  roll: string | null;
  displayName: string | null;
  stale: boolean;
  /** The college's own record for the saved roll, when it still exists. */
  student: StudentInfo | null;
  /** A suggestion for the empty form, not the caller's identity. */
  lastLookup: string | null;
  /** Finished daily runs, newest first, for the profile's history. */
  runs: GameRun[];
}

type ProfileStatus =
  | { state: "loading" }
  | { state: "ready"; profile: Profile }
  | { state: "error" };

/** One shape for both the first read and the refresh after a save. */
const toProfile = (data: ProfileResponse): Profile => {
  if (data.found && "registration" in data) {
    return {
      found: true,
      registered: true,
      roll: data.registration.roll_no,
      displayName: data.registration.display_name,
      stale: "stale" in data ? Boolean(data.stale) : false,
      student: data.student,
      lastLookup: null,
      runs: data.runs ?? [],
    };
  }

  // the form stays empty for an unregistered user; the past lookup is shown
  // beside it and only fills the field when tapped
  const unregistered = data as {
    lastLookup?: string | null;
    suggestion?: string | null;
  };
  return {
    found: false,
    registered: false,
    roll: null,
    displayName: null,
    stale: false,
    student: null,
    lastLookup: unregistered.lastLookup ?? unregistered.suggestion ?? null,
    runs: "runs" in data ? (data.runs ?? []) : [],
  };
};

/**
 * Profile/registration data layer: loads the caller's registration and
 * submits edits. Identity rules are the same everywhere: initData inside
 * Telegram, dev userId shortcut outside.
 */
export const useProfile = (
  tgUser: string | null,
  initData?: string,
): {
  status: ProfileStatus;
  save: (
    rollNo: string,
    displayName: string,
  ) => Promise<{ error: string | null; suggestions?: string[] }>;
  /** Removes the last-lookup suggestion; the registration is untouched. */
  forgetLookup: () => Promise<void>;
} => {
  const [status, setStatus] = useState<ProfileStatus>({ state: "loading" });

  const fetchProfile = useCallback(
    async (): Promise<Profile> =>
      toProfile(await getProfile({ userId: tgUser ?? undefined, initData })),
    [tgUser, initData],
  );

  useEffect(() => {
    if (!tgUser) return;
    let cancelled = false;

    fetchProfile()
      .then((profile) => {
        if (cancelled) return;
        setStatus({ state: "ready", profile });
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [tgUser, fetchProfile]);

  const save = useCallback(
    async (
      rollNo: string,
      displayName: string,
    ): Promise<{ error: string | null; suggestions?: string[] }> => {
      try {
        await registerRoll({
          userId: tgUser ?? undefined,
          initData,
          rollNo,
          displayName: displayName || undefined,
        });

        // Paint the fresh record in one step: a successful save switches the
        // screen to the read-only summary, so the college's branch/section/year
        // should be there when it does. A failed re-read falls back to the
        // values we already know.
        let fresh: Profile | null = null;
        try {
          fresh = await fetchProfile();
        } catch {
          // the optimistic profile is enough; the next visit refetches
        }

        setStatus((prev) =>
          fresh?.registered
            ? { state: "ready", profile: fresh }
            : prev.state === "ready"
              ? {
                  state: "ready",
                  profile: {
                    ...prev.profile,
                    found: true,
                    registered: true,
                    roll: rollNo.toUpperCase(),
                    displayName: displayName || null,
                    stale: false,
                    lastLookup: null,
                  },
                }
              : prev,
        );

        return { error: null };
      } catch (e) {
        return {
          error: (e as Error).message || "Could not save your profile",
          suggestions: (e as Error & { suggestions?: string[] }).suggestions,
        };
      }
    },
    [tgUser, initData, fetchProfile],
  );

  const forgetLookup = useCallback(async (): Promise<void> => {
    await deleteLastLookup({ userId: tgUser ?? undefined, initData });
    setStatus((prev) =>
      prev.state === "ready"
        ? {
            state: "ready",
            profile: { ...prev.profile, lastLookup: null },
          }
        : prev,
    );
  }, [tgUser, initData]);

  return { status, save, forgetLookup };
};
