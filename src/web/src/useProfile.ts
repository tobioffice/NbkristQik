import { useCallback, useEffect, useState } from "react";
import {
  deleteLastLookup,
  getProfile,
  registerRoll,
  type ProfileResponse,
} from "./api";

interface Profile {
  found: boolean;
  registered: boolean;
  /** The saved registration's roll. A past lookup never fills this. */
  roll: string | null;
  displayName: string | null;
  stale: boolean;
  studentName: string | null;
  /** A suggestion for the empty form, not the caller's identity. */
  lastLookup: string | null;
}

type ProfileStatus =
  | { state: "loading" }
  | { state: "ready"; profile: Profile }
  | { state: "error" };

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

  useEffect(() => {
    if (!tgUser) return;
    let cancelled = false;

    getProfile({ userId: tgUser, initData })
      .then((data: ProfileResponse) => {
        if (cancelled) return;
        if (data.found && "registration" in data) {
          setStatus({
            state: "ready",
            profile: {
              found: true,
              registered: true,
              roll: data.registration.roll_no,
              displayName: data.registration.display_name,
              stale: "stale" in data ? Boolean(data.stale) : false,
              studentName: data.student?.name ?? null,
              lastLookup: null,
            },
          });
        } else {
          // the form stays empty for an unregistered user; the past lookup
          // is shown beside it and only fills the field when tapped
          const unregistered = data as {
            lastLookup?: string | null;
            suggestion?: string | null;
          };
          const lastLookup =
            unregistered.lastLookup ?? unregistered.suggestion ?? null;
          setStatus({
            state: "ready",
            profile: {
              found: false,
              registered: false,
              roll: null,
              displayName: null,
              stale: false,
              studentName: null,
              lastLookup,
            },
          });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [tgUser, initData]);

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
        setStatus((prev) =>
          prev.state === "ready"
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
          error:
            (e as Error).message || "Could not save your profile",
          suggestions: (e as Error & { suggestions?: string[] }).suggestions,
        };
      }
    },
    [tgUser, initData],
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