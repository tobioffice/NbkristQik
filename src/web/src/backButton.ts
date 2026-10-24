import { useEffect } from "react";
import { telegramWebApp } from "./telegram";

/**
 * The Telegram back button, as a stack.
 *
 * Inside the webview there is no browser chrome, so the platform's own back
 * arrow is the only way out of a screen. Two screens can be open at once — the
 * reader sits on top of the library — and only the top one should close.
 *
 * Each caller pushes its handler while it is mounted; the button dispatches
 * to the last one pushed, and hides itself when the stack is empty.
 */

const handlers: Array<() => void> = [];
let clickWired = false;

const backButton = () => telegramWebApp()?.BackButton;

const dispatch = (): void => {
  handlers[handlers.length - 1]?.();
};

const sync = (): void => {
  const button = backButton();
  if (!button) return;

  if (!clickWired) {
    button.onClick(dispatch);
    clickWired = true;
  }
  if (handlers.length > 0) button.show();
  else button.hide();
};

/** Closes this screen when the Telegram back arrow is pressed. */
export const useBackHandler = (handler: (() => void) | null): void => {
  useEffect(() => {
    if (!handler) return;

    handlers.push(handler);
    sync();

    return () => {
      const at = handlers.lastIndexOf(handler);
      if (at >= 0) handlers.splice(at, 1);
      sync();
    };
  }, [handler]);
};
