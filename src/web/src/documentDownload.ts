import { requestDocumentDownload } from "./libraryApi";
import { telegramWebApp } from "./telegram";

/**
 * Saving a document as a PDF.
 *
 * A plain link to a PDF does not download inside a mini app: the webview
 * shows the file in place, the `download` attribute is ignored, and an iOS
 * WKWebView cannot download at all. Telegram added `WebApp.downloadFile` in
 * Bot API 8.0, which hands the URL to the client and lets it save the file
 * the way it saves any other. Clients older than that fall back to the
 * system browser, which downloads the ordinary way.
 *
 * The client fetches the URL itself, with no cookie jar, so the API mints a
 * short-lived link for that one reader and document.
 */

/** The client only accepts an absolute https address. */
const absolute = (path: string): string =>
  new URL(path, window.location.origin).href;

/** Say what went wrong where the reader will see it. */
export const explainDownloadFailure = (message: string): void => {
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

export const saveDocumentPdf = async (docId: string): Promise<void> => {
  const link = await requestDocumentDownload(docId);
  if (!link.ok || !link.url) {
    throw new Error(link.error ?? "Could not prepare this PDF.");
  }

  const url = absolute(link.url);
  const app = telegramWebApp();

  if (app?.downloadFile) {
    try {
      app.downloadFile({ url, file_name: link.fileName });
      return;
    } catch {
      // a client that reports the method but predates Bot API 8.0
    }
  }

  if (app?.openLink) {
    try {
      app.openLink(url, { try_instant_view: false });
      return;
    } catch {
      // fall through to the browser
    }
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = link.fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};
