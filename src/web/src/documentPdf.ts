import { requestDocumentOpen, requestDocumentSend } from "./libraryApi";
import { telegramWebApp } from "./telegram";

/**
 * Opening a document as a PDF.
 *
 * The stamped PDF is opened by the phone's or computer's own viewer, not by
 * an iframe we ship: `WebApp.openLink` hands the URL to Safari or the system
 * browser, whose native viewer zooms smoothly. The URL carries a one-document
 * token because that browser has its own cookie jar; the session cookie is
 * not there.
 *
 * A client too old for `openLink` still gets the file: the bot sends the
 * stamped copy to the reader's chat, where every client knows how to open it.
 */

/** Say something where the reader will see it. */
export const notifyReader = (message: string): void => {
  const app = telegramWebApp();
  try {
    if (app?.showAlert) {
      app.showAlert(message);
      return;
    }
  } catch {
    // an old client that refuses the call still gets an alert below
  }
  window.alert(message);
};

/** Ask for a viewer link and hand it to the platform. */
export const openDocumentPdf = async (docId: string): Promise<void> => {
  const { url } = await requestDocumentOpen(docId);
  const href = new URL(url, window.location.origin).href;

  const app = telegramWebApp();
  if (app) {
    if (app.openLink) {
      try {
        app.openLink(href);
        return;
      } catch {
        // a client that refuses the URL still has the chat below
      }
    }

    // A webview too old to hand the link out: the chat is the one route to a
    // file that always works.
    const sent = await requestDocumentSend(docId);
    notifyReader(`Sent to your chat: ${sent.fileName}`);
    return;
  }

  // A plain browser (the one-time PC link): navigating in the same tab cannot
  // be popup-blocked, and the browser's own PDF viewer takes it from here.
  window.location.assign(href);
};
