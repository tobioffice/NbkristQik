/* eslint-disable react-refresh/only-export-components --
   the provider and its hook belong together; splitting them would hide the
   one-fetch contract from the next reader */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getMe, mapMe, type ApiIdentity, type MyRank } from "./api";
import { useTelegramIdentity } from "./useTelegramIdentity";

/**
 * One identity for the whole app.
 *
 * Every screen used to ask `/api/me` for itself, and each answer ran rank
 * queries over the whole register. The shell now asks once, keeps the answer
 * for the life of the page, and hands it down. `refresh` is the only way to
 * ask again: after saving a roll, or forgetting a friend's lookup.
 */

export type IdentityStatus =
  | "loading"
  | "anonymous"
  | "no-roll"
  | "ready"
  | "error";

export interface Identity {
  status: IdentityStatus;
  /** The saved registration's roll. Never a past lookup. */
  roll: string | null;
  ranks: MyRank | null;
  source: "registered" | null;
  /** The last roll this account looked up, kept separate from `roll`. */
  lastLookup: string | null;
  error: string | null;
  /** Ask `/api/me` again, keeping the current screen until it answers. */
  refresh: () => void;
}

const IDLE: Identity = {
  status: "anonymous",
  roll: null,
  ranks: null,
  source: null,
  lastLookup: null,
  error: null,
  refresh: () => {},
};

const IdentityContext = createContext<Identity | null>(null);

interface MeSnapshot {
  status: "ready" | "no-roll" | "error";
  roll: string | null;
  ranks: MyRank | null;
  source: "registered" | null;
  lastLookup: string | null;
  error: string | null;
}

/**
 * The page-lifetime answer. React StrictMode mounts effects twice in
 * development; sharing the same promise keeps that from doubling the call,
 * and a retry deliberately replaces the cached failure.
 */
let cache: { key: string; promise: Promise<MeSnapshot> } | null = null;

const loadMe = (
  identity: ApiIdentity,
  key: string,
  force: boolean,
): Promise<MeSnapshot> => {
  if (!force && cache?.key === key) return cache.promise;

  const promise = getMe(identity)
    .then((me): MeSnapshot => {
      const mapped = mapMe(me);
      return { ...mapped, error: null };
    })
    .catch((error: unknown): MeSnapshot => {
      // a failure is not an answer: let the next mount or Retry ask again
      if (cache?.promise === promise) cache = null;
      return {
        status: "error",
        roll: null,
        ranks: null,
        source: null,
        lastLookup: null,
        error:
          error instanceof Error
            ? error.message
            : "Could not check your roll right now.",
      };
    });

  cache = { key, promise };
  return promise;
};

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { tgUser, initData } = useTelegramIdentity();
  const [snapshot, setSnapshot] = useState<MeSnapshot | null>(null);
  const [nonce, setNonce] = useState(0);
  const forceNext = useRef(false);

  const refresh = useCallback(() => {
    forceNext.current = true;
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!tgUser) return;

    let cancelled = false;
    const force = forceNext.current;
    forceNext.current = false;

    loadMe({ userId: tgUser, initData }, tgUser, force).then((next) => {
      if (!cancelled) setSnapshot(next);
    });

    return () => {
      cancelled = true;
    };
  }, [tgUser, initData, nonce]);

  const value = useMemo<Identity>(() => {
    if (!tgUser) return IDLE;
    if (!snapshot) return { ...IDLE, status: "loading" };

    return {
      status: snapshot.status,
      roll: snapshot.roll,
      ranks: snapshot.ranks,
      source: snapshot.source,
      lastLookup: snapshot.lastLookup,
      error: snapshot.error,
      refresh,
    };
  }, [tgUser, snapshot, refresh]);

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

/**
 * The shared identity. Outside a provider it reads as anonymous, which keeps
 * a view renderable in isolation without pretending a roll exists.
 */
export const useIdentity = (): Identity =>
  useContext(IdentityContext) ?? IDLE;
