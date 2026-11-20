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
  initDataUnsafe?: {
    user?: { id?: number };
    /** The `startapp` value of a direct link, when the app was opened by one. */
    start_param?: string;
  };
  /** "android" | "ios" | "tdesktop" | "macos" | "web" | ... */
  platform?: string;
  /** The client's current palette, as CSS colours. */
  themeParams?: {
    bg_color?: string;
    secondary_bg_color?: string;
    text_color?: string;
    hint_color?: string;
  };
  colorScheme?: "light" | "dark";
  /** Telegram's own event bus (`themeChanged`, `viewportChanged`, ...). */
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
  /** True once Telegram's own header has stepped away. */
  isFullscreen?: boolean;
  BackButton?: BackButton;
  HapticFeedback?: HapticFeedback;
  /** Opens the native share sheet for a prepared inline message. */
  shareMessage?: (msgId: string, callback?: (sent: boolean) => void) => void;
  /** Hands a URL to the browser outside the mini app (Bot API 6.0+). */
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  /** A native alert, when the client has one. */
  showAlert?: (message: string) => void;
}

/** The SDK, when the page is running inside Telegram. */
export const telegramWebApp = (): TelegramWebApp | undefined => {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } })
    .Telegram?.WebApp;
};

/** The app's chrome: the native header and the dark content ground. */
const HEADER_COLOR = "#212a33";
const BG_COLOR = "#1a2026";

/** Apply the chrome once the SDK is there; true when it had a client to ask. */
const applyTelegramChrome = (): boolean => {
  const app = telegramWebApp();
  if (!app) return false;

  try {
    app.setHeaderColor?.(HEADER_COLOR);
  } catch {
    // an older client may not know a call; the page still reads
  }
  try {
    app.setBackgroundColor?.(BG_COLOR);
  } catch {
    // ignore
  }
  try {
    app.setBottomBarColor?.(HEADER_COLOR);
  } catch {
    // ignore
  }
  try {
    app.ready?.();
  } catch {
    // ignore
  }
  try {
    app.expand?.();
  } catch {
    // ignore
  }
  try {
    // Fullscreen hands the app the whole screen: the native header steps
    // away, its floating controls remain, and the client publishes the two
    // safe-area insets the sheet pads itself with. BotFather asks for it on
    // phones; desktop windows already fill their frame.
    const mobile = app.platform === "android" || app.platform === "ios";
    if (mobile && !app.isFullscreen) app.requestFullscreen?.();
  } catch {
    // an older client simply keeps the expanded app
  }
  try {
    // the register scrolls vertically: a swipe must scroll it, not shrink
    // the mini app back to its compact height
    app.disableVerticalSwipes?.();
  } catch {
    // ignore
  }

  return true;
};

/**
 * Set the client's chrome and tell it the sheet is ready.
 *
 * The SDK is deferred, so the page no longer waits for it before painting.
 * If the module happens to run before the deferred script, this runs again
 * at the end of parsing — which is always after every deferred script.
 * Outside Telegram, or on a client that refuses a call, it does nothing
 * harmful: each step is best-effort.
 */
export const bootstrapTelegram = (): void => {
  if (applyTelegramChrome()) return;
  if (typeof document === "undefined") return;
  if (document.readyState === "complete") return;

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      applyTelegramChrome();
    },
    { once: true },
  );
};

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
