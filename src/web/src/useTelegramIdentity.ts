import { useState } from "react";
import { telegramWebApp } from "./telegram";

/**
 * Shared identity for all webapp API calls: the raw Telegram user id plus
 * signed initData. null outside the Telegram webview (dev shortcut applies).
 * The WebApp SDK is injected before the bundle runs, so a lazy initializer
 * (not an effect) is the right way to read it once.
 */
export const useTelegramIdentity = (): {
  tgUser: string | null;
  initData: string | undefined;
} => {
  const [{ tgUser, initData }] = useState(() => {
    try {
      const tg = telegramWebApp();
      const id = tg?.initDataUnsafe?.user?.id;
      if (id) return { tgUser: String(id), initData: tg?.initData };

      // dev only: `?devUser=123` lets the pages be opened in a browser with a
      // stand-in identity. The build folds this branch away in production, so
      // a deployed page can never be talked into believing one.
      if (import.meta.env.DEV) {
        const dev = new URLSearchParams(window.location.search).get("devUser");
        if (dev) {
          return {
            tgUser: dev,
            initData: `auth_date=1&hash=dev&user=${encodeURIComponent(`{"id":${dev}}`)}`,
          };
        }
      }
      return { tgUser: null, initData: undefined };
    } catch {
      return { tgUser: null, initData: undefined };
    }
  });

  return { tgUser, initData };
};