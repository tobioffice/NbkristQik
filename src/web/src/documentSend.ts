import { requestDocumentSend } from "./libraryApi";
import { telegramWebApp } from "./telegram";

/**
 * Getting a document as a file.
 *
 * A mini app cannot download: the webview opens a PDF in place, the HTML
 * `download` attribute is ignored, and an iOS WKWebView has no downloads at
 * all. So the bot sends the stamped copy to the reader's own chat, where
 * every client already knows how to save it.
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

export const sendDocumentPdf = async (docId: string): Promise<void> => {
  const result = await requestDocumentSend(docId);
  notifyReader(`Sent to your chat: ${result.fileName}`);
};
