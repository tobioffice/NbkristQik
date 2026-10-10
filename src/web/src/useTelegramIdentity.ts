import { useState } from "react";

interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number } };
}

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
      const tg = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
        ?.WebApp;
      const id = tg?.initDataUnsafe?.user?.id;
      return {
        tgUser: id ? String(id) : null,
        initData: id ? tg?.initData : undefined,
      };
    } catch {
      return { tgUser: null, initData: undefined };
    }
  });

  return { tgUser, initData };
};