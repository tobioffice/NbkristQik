import { useCallback, useEffect, useState } from "react";
import {
  getProfile,
  registerRoll,
  type ProfileResponse,
} from "./api";

interface Profile {
  found: boolean;
  registered: boolean;
  /** registered roll (or the past-lookup suggestion when unregistered) */
  roll: string | null;
  displayName: string | null;
  stale: boolean;
  studentName: string | null;
}

type ProfileStatus =
  | { state: "loading" }
  | { state: "ready"; profile: Profile }
  | { state: "error" };

/**
 * Profile/registration data layer: loads the caller's registration and
 * submits edits. Same identity rules as useTelegramUser — initData inside
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
            },
          });
        } else {
          const suggestion = "suggestion" in data ? data.suggestion : null;
          setStatus({
            state: "ready",
            profile: {
              found: false,
              registered: false,
              roll: suggestion ?? null,
              displayName: null,
              stale: false,
              studentName: null,
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

  return { status, save };
};