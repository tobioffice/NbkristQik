import { useEffect, useState } from "react";
import { fetchAppConfig, type AppConfig } from "./api";

/** What the shell may show before the config has answered: the safe default. */
const CLOSED: AppConfig = { libraryOpen: false, admin: false };

export interface AppConfigState extends AppConfig {
  /** True until `/api/config` has answered (or failed). */
  loading: boolean;
}

/**
 * The shell's feature switches.
 *
 * `/api/config` is the server's answer to "may this caller open the library
 * yet?", and it is identity-aware: the signed header is enough, and an
 * anonymous visitor is quietly told the shelf is shut. Until it answers, the
 * library is treated as closed, so no page ever promises a shelf it cannot
 * serve. A failed request settles on the same closed default instead of
 * holding the shell in a loading state forever.
 */
export const useAppConfig = (
  userId?: string,
  initData?: string,
): AppConfigState => {
  const [state, setState] = useState<{ config: AppConfig; loading: boolean }>({
    config: CLOSED,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState((previous) =>
      previous.loading ? previous : { ...previous, loading: true },
    );

    fetchAppConfig({ userId, initData })
      .then((config) => {
        if (!cancelled) setState({ config, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ config: CLOSED, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [userId, initData]);

  return { ...state.config, loading: state.loading };
};
