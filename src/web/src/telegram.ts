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

export interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number } };
  BackButton?: BackButton;
}

/** The SDK, when the page is running inside Telegram. */
export const telegramWebApp = (): TelegramWebApp | undefined =>
  (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
    ?.WebApp;
