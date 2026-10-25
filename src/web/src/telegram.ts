import { useEffect } from "react";

/**
 * The slice of the Telegram WebApp SDK this app uses.
 *
 * The SDK is injected by the Telegram client before the bundle runs, so it is
 * read straight off `window`; outside Telegram everything here is undefined
 * and each caller decides what "no Telegram" means for it.
 */

interface BackButton {
  show: () => void;
  hide: () => void;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
}

interface HapticFeedback {
  impactOccurred: (
    style: "light" | "medium" | "heavy" | "rigid" | "soft",
  ) => void;
  selectionChanged: () => void;
  notificationOccurred: (type: "error" | "success" | "warning") => void;
}

export interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number } };
  BackButton?: BackButton;
  HapticFeedback?: HapticFeedback;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
}

/** The SDK, when the page is running inside Telegram. */
export const telegramWebApp = (): TelegramWebApp | undefined =>
  (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
    ?.WebApp;

/**
 * The sheet fills the webview. Called after mount as well as in the page
 * head: the client can hand back a compact height, and a register is meant to
 * be read at full height.
 */
export const expandApp = (): void => {
  try {
    telegramWebApp()?.expand?.();
  } catch {
    // haptics and viewport calls are best-effort; never break the page
  }
};

/**
 * Touch feedback, matching the interface: a light tap for an action that
 * changes the page, a selection tick for a filter. Silent outside Telegram.
 */
export const haptic = {
  tap: (): void => {
    try {
      telegramWebApp()?.HapticFeedback?.impactOccurred("light");
    } catch {
      // ignore: haptics are a courtesy
    }
  },
  select: (): void => {
    try {
      telegramWebApp()?.HapticFeedback?.selectionChanged();
    } catch {
      // ignore
    }
  },
};

/**
 * Ask before closing while there is unsent text on the page. A half-written
 * report is worth more than a fast exit.
 */
export const useClosingConfirmation = (active: boolean): void => {
  useEffect(() => {
    const app = telegramWebApp();
    if (!app) return;

    try {
      if (active) app.enableClosingConfirmation?.();
      else app.disableClosingConfirmation?.();
    } catch {
      // ignore: an unsupported client simply closes without asking
    }

    return () => {
      try {
        app.disableClosingConfirmation?.();
      } catch {
        // ignore
      }
    };
  }, [active]);
};
