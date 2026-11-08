import { useEffect, useState } from "react";
import { telegramWebApp } from "./telegram";

/**
 * Shared identity for all webapp API calls: the raw Telegram user id plus
 * signed initData. null outside the Telegram webview (dev shortcut applies).
 *
 * The SDK is a deferred script, so the first render can happen before it has
 * run. The identity is read synchronously as before; when there is no SDK yet
 * the hook waits for the end of parsing (always after the deferred script)
 * and reads once more. The shell paints its paper immediately, then the
 * identity appears and `/api/me` runs. It never stays anonymous because the
 * SDK was a moment late.
 */

interface TelegramIdentity {
  tgUser: string | null;
  initData: string | undefined;
}

const ANONYMOUS: TelegramIdentity = { tgUser: null, initData: undefined };

/** Read whatever the SDK is holding right now. Never throws. */
const readTelegramIdentity = (): TelegramIdentity => {
  try {
    const tg = telegramWebApp();
    const id = tg?.initDataUnsafe?.user?.id;
    if (id) return { tgUser: String(id), initData: tg?.initData };

    // dev only: `?devUser=123` lets the pages be opened in a browser with a
    // stand-in identity. There is no real signed initData off Telegram, so
    // the id travels as the dev fallback; the server only accepts it when
    // ALLOW_DEV_IDENTITY is on. The build folds this branch away in
    // production, so a deployed page can never be talked into believing it.
    if (import.meta.env.DEV) {
      const dev = new URLSearchParams(window.location.search).get("devUser");
      if (dev) return { tgUser: dev, initData: undefined };
    }
    return ANONYMOUS;
  } catch {
    return ANONYMOUS;
  }
};

export const useTelegramIdentity = (): {
  tgUser: string | null;
  initData: string | undefined;
} => {
  const [identity, setIdentity] = useState(readTelegramIdentity);

  useEffect(() => {
    if (identity.tgUser || typeof document === "undefined") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reread = () => {
      if (cancelled) return;
      const next = readTelegramIdentity();
      if (next.tgUser) setIdentity(next);
    };

    if (document.readyState !== "complete") {
      // A deferred classic script always runs before DOMContentLoaded, and
      // the entry module is deferred too: waiting for the parse to finish is
      // what guarantees the SDK had its turn.
      document.addEventListener("DOMContentLoaded", reread, { once: true });
      // DOMContentLoaded can be late on a slow image; one early read is
      // harmless, and the listener still covers a slower SDK.
      timer = setTimeout(reread, 1000);
    } else {
      // already parsed (hot reload, bfcache): the SDK is there or it is not
      reread();
    }

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("DOMContentLoaded", reread);
    };
  }, [identity.tgUser]);

  return identity;
};
